package harness

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/tonitienda/agent-world-lab/internal/executor"
)

// CodexPlayerImage is built by `make codex-player-image` from docker/codex-player.
// The image holds Codex only: no repository, scenario or host home directory.
const CodexPlayerImage = "emergence-codex-player:0.167.0"

const (
	mcpTokenEnv   = "EMERGENCE_MCP_TOKEN"
	codexHomeDir  = "/codex"
	serverStartup = 6 * time.Minute // three cameras open before the port; each may take 90 s under team load
	// The server transcodes every camera after the session ends; three long
	// takes need minutes, and killing it leaves .partial videos (episode-006 take-004).
	serverFinish = 15 * time.Minute
)

// codexPlayer is the docker invocation for one isolated Codex player. Codex's
// own tools stay disabled as for the designer; the container adds the boundary
// the read-only sandbox lacks: its filesystem is the image, a private tmpfs and
// a throwaway CODEX_HOME holding only credentials.
func codexPlayer(r Request, container, home, url string) executor.Request {
	args := []string{"run", "--rm", "-i", "--name", container,
		"--read-only", "--tmpfs", "/tmp:rw,nosuid,nodev,size=256m",
		"--mount", "type=bind,src=" + home + ",dst=" + codexHomeDir,
		"--cap-drop", "ALL", "--security-opt", "no-new-privileges",
		"--pids-limit", "512", "--memory", "4g", "--user", "1000:1000",
		"-e", "HOME=/tmp", "-e", "CODEX_HOME=" + codexHomeDir, "-e", mcpTokenEnv}
	if runtime.GOOS == "linux" {
		// Linux has no host.docker.internal loopback bridge; share the host network
		// so the loopback-only MCP port is reachable and nothing else is exposed.
		args = append(args, "--network", "host")
	} else {
		args = append(args, "--add-host", "host.docker.internal:host-gateway")
	}
	for _, k := range []string{"CODEX_API_KEY", "OPENAI_API_KEY"} {
		if envValue(r.Env, k) != "" {
			args = append(args, "-e", k) // value comes from the docker client's env, not argv
		}
	}
	args = append(args, CodexPlayerImage, "exec", "--ignore-user-config", "--ignore-rules", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only",
		"--disable", "shell_tool", "--disable", "unified_exec", "--disable", "apps", "--disable", "plugins", "--disable", "multi_agent", "--disable", "view_image",
		"-c", `web_search="disabled"`,
		"-c", fmt.Sprintf("mcp_servers.agent-world.url=%q", url),
		"-c", fmt.Sprintf("mcp_servers.agent-world.bearer_token_env_var=%q", mcpTokenEnv),
		"-c", "mcp_servers.agent-world.startup_timeout_sec=60",
		"-c", "mcp_servers.agent-world.tool_timeout_sec=180",
		// exec has nobody to approve MCP calls; pre-approve only the game server.
		"-c", `mcp_servers.agent-world.default_tools_approval_mode="approve"`)
	if r.Model != "" && r.Model != "configured-default" {
		args = append(args, "--model", r.Model)
	}
	args = append(args, "-")
	return executor.Request{Program: "docker", Args: args, Dir: r.Dir, Env: r.Env, Stdin: strings.NewReader(r.Prompt), Stdout: r.Stdout, Stderr: r.Stderr, OnCancel: r.OnCancel}
}

// mcpURL is where the container reaches a host port bound to 127.0.0.1.
func mcpURL(port int) string {
	host := "host.docker.internal"
	if runtime.GOOS == "linux" {
		host = "127.0.0.1"
	}
	return fmt.Sprintf("http://%s:%d/mcp", host, port)
}

type mcpServer struct {
	Command string            `json:"command"`
	Args    []string          `json:"args"`
	Env     map[string]string `json:"env"`
}

func readMCPServer(path string) (mcpServer, error) {
	var c struct {
		MCPServers map[string]mcpServer `json:"mcpServers"`
	}
	b, e := os.ReadFile(path)
	if e == nil {
		e = json.Unmarshal(b, &c)
	}
	s, ok := c.MCPServers["agent-world"]
	if e == nil && (!ok || s.Command == "") {
		e = errors.New("no agent-world server")
	}
	if e != nil {
		return s, fmt.Errorf("codex player MCP config: %w", e)
	}
	return s, nil
}

// runCodexPlayer supervises the trusted MCP server on the host and Codex in its
// container. Closing the server's stdin when Codex exits ends the session the
// same way Claude closing its stdio transport does.
func (c CLI) runCodexPlayer(ctx context.Context, r Request) (executor.Result, error) {
	server, e := readMCPServer(r.MCPConfig)
	if e != nil {
		return executor.Result{ExitCode: -1}, e
	}
	token, e := randomHex(32)
	if e != nil {
		return executor.Result{ExitCode: -1}, e
	}
	port, e := freePort()
	if e != nil {
		return executor.Result{ExitCode: -1}, e
	}
	home, e := os.MkdirTemp("", "emergence-codex-home-*")
	if e != nil {
		return executor.Result{ExitCode: -1}, e
	}
	defer os.RemoveAll(home)
	restore, e := stageCodexAuth(r.Env, home)
	if e != nil {
		return executor.Result{ExitCode: -1}, e
	}
	defer restore()

	env := append([]string{}, r.Env...)
	for k, v := range server.Env {
		env = append(env, k+"="+v)
	}
	env = append(env, fmt.Sprintf("EMERGENCE_MCP_HTTP_PORT=%d", port), "EMERGENCE_MCP_HTTP_HOST=127.0.0.1", "EMERGENCE_MCP_HTTP_TOKEN="+token)
	stdin, hangup := io.Pipe()
	serverCtx, stopServer := context.WithCancel(context.WithoutCancel(ctx))
	defer stopServer()
	serverDone := make(chan error, 1)
	go func() {
		_, err := c.Runner.Run(serverCtx, executor.Request{Program: server.Command, Args: server.Args, Dir: r.Dir, Env: env, Stdin: stdin, Stdout: r.Stderr, Stderr: r.Stderr})
		serverDone <- err
	}()
	finish := func() {
		hangup.Close()
		select {
		case <-serverDone:
		case <-time.After(serverFinish):
			stopServer()
			<-serverDone
		}
	}
	if e = waitForPort(ctx, port, serverDone); e != nil {
		finish()
		return executor.Result{ExitCode: -1}, e
	}

	name := "emergence-codex-" + token[:12]
	q := codexPlayer(r, name, home, mcpURL(port))
	q.Env = append(append([]string{}, r.Env...), mcpTokenEnv+"="+token)
	result, runErr := c.Runner.Run(ctx, q)
	// A killed docker client leaves its container running; remove it explicitly.
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	_, _ = c.Runner.Run(cleanup, executor.Request{Program: "docker", Args: []string{"rm", "--force", name}, Dir: r.Dir, Env: r.Env})
	cancel()
	finish()
	return result, runErr
}

func waitForPort(ctx context.Context, port int, done <-chan error) error {
	deadline := time.Now().Add(serverStartup)
	for time.Now().Before(deadline) {
		select {
		case err := <-done:
			return fmt.Errorf("agent-world MCP server exited before serving Codex: %v", err)
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		if conn, e := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), time.Second); e == nil {
			conn.Close()
			return nil
		}
		time.Sleep(250 * time.Millisecond)
	}
	return fmt.Errorf("agent-world MCP server did not start within %s", serverStartup)
}

// stageCodexAuth gives the container a private copy of the host's Codex login
// (unless an API key is supplied). OAuth refresh tokens rotate, so a refreshed
// copy is written back, but only over an unchanged host file and only if it is
// still a JSON object.
func stageCodexAuth(env []string, home string) (func(), error) {
	if envValue(env, "CODEX_API_KEY") != "" || envValue(env, "OPENAI_API_KEY") != "" {
		return func() {}, nil
	}
	host, e := hostCodexAuth(env)
	if e != nil {
		return nil, e
	}
	original, e := os.ReadFile(host)
	if e != nil {
		return nil, fmt.Errorf("Codex is not logged in (%s); run codex login or set CODEX_API_KEY: %w", host, e)
	}
	staged := filepath.Join(home, "auth.json")
	if e = os.WriteFile(staged, original, 0600); e != nil {
		return nil, e
	}
	return func() {
		updated, e := os.ReadFile(staged)
		var object map[string]any
		if e != nil || bytes.Equal(updated, original) || json.Unmarshal(updated, &object) != nil {
			return
		}
		if current, e := os.ReadFile(host); e == nil && bytes.Equal(current, original) {
			_ = os.WriteFile(host, updated, 0600)
		}
	}, nil
}

func hostCodexAuth(env []string) (string, error) {
	if h := envValue(env, "CODEX_HOME"); h != "" {
		return filepath.Join(h, "auth.json"), nil
	}
	h := envValue(env, "HOME")
	if h == "" {
		var e error
		if h, e = os.UserHomeDir(); e != nil {
			return "", e
		}
	}
	return filepath.Join(h, ".codex", "auth.json"), nil
}

func envValue(env []string, key string) string {
	v := ""
	for _, kv := range env {
		if k, value, ok := strings.Cut(kv, "="); ok && k == key {
			v = value
		}
	}
	return v
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, e := rand.Read(b); e != nil {
		return "", e
	}
	return hex.EncodeToString(b), nil
}

func freePort() (int, error) {
	l, e := net.Listen("tcp", "127.0.0.1:0")
	if e != nil {
		return 0, e
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

// checkCodexPlayer confirms docker, the player image and a Codex login exist
// before any world is restored.
func (c CLI) checkCodexPlayer(ctx context.Context, r Request) error {
	if _, e := c.Runner.Run(ctx, executor.Request{Program: "docker", Args: []string{"image", "inspect", "--format", "{{.Id}}", CodexPlayerImage}, Dir: r.Dir, Env: r.Env, Stdout: io.Discard}); e != nil {
		return fmt.Errorf("isolated Codex player image %s missing; run make codex-player-image: %w", CodexPlayerImage, e)
	}
	if envValue(r.Env, "CODEX_API_KEY") != "" || envValue(r.Env, "OPENAI_API_KEY") != "" {
		return nil
	}
	host, e := hostCodexAuth(r.Env)
	if e == nil {
		_, e = os.Stat(host)
	}
	if e != nil {
		return fmt.Errorf("Codex is not logged in; run codex login or set CODEX_API_KEY: %w", e)
	}
	return nil
}
