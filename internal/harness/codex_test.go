package harness

import (
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/tonitienda/agent-world-lab/internal/executor"
)

// playerRunner stands in for the MCP server (listening on the port it is given
// until its stdin closes) and for docker.
type playerRunner struct {
	mu       sync.Mutex
	calls    []executor.Request
	hungUp   bool
	refresh  string
	tokenSet bool
}

func (p *playerRunner) Run(ctx context.Context, q executor.Request) (executor.Result, error) {
	p.mu.Lock()
	p.calls = append(p.calls, q)
	p.mu.Unlock()
	switch {
	case q.Program == "npm":
		l, e := net.Listen("tcp", "127.0.0.1:"+envValue(q.Env, "EMERGENCE_MCP_HTTP_PORT"))
		if e != nil {
			return executor.Result{ExitCode: 1}, e
		}
		defer l.Close()
		io.Copy(io.Discard, q.Stdin) // returns once the supervisor hangs up
		p.mu.Lock()
		p.hungUp = true
		p.mu.Unlock()
	case len(q.Args) > 0 && q.Args[0] == "run":
		home := ""
		for _, a := range q.Args {
			if src, ok := strings.CutPrefix(a, "type=bind,src="); ok {
				home = strings.Split(src, ",")[0]
			}
		}
		b, _ := os.ReadFile(filepath.Join(home, "auth.json"))
		p.tokenSet = len(envValue(q.Env, mcpTokenEnv)) == 64 && string(b) == `{"refresh":"old"}`
		os.WriteFile(filepath.Join(home, "auth.json"), []byte(p.refresh), 0600)
		fmt.Fprint(q.Stdout, "final message")
	}
	return executor.Result{}, nil
}

func TestCodexPlayerLifecycle(t *testing.T) {
	home := t.TempDir()
	os.MkdirAll(filepath.Join(home, ".codex"), 0700)
	auth := filepath.Join(home, ".codex", "auth.json")
	os.WriteFile(auth, []byte(`{"refresh":"old"}`), 0600)
	config := filepath.Join(t.TempDir(), "mcp.json")
	os.WriteFile(config, []byte(`{"mcpServers":{"agent-world":{"command":"npm","args":["run","mcp"],"env":{"AGENT_ID":"bram"}}}}`), 0600)
	for name, refreshed := range map[string]string{"rotated login is kept": `{"refresh":"new"}`, "invalid login is discarded": `not json`} {
		t.Run(name, func(t *testing.T) {
			os.WriteFile(auth, []byte(`{"refresh":"old"}`), 0600)
			p := &playerRunner{refresh: refreshed}
			var out strings.Builder
			_, e := (CLI{Runner: p}).Run(context.Background(), Request{Harness: "codex", Player: true, MCPConfig: config, Prompt: "goal", Env: []string{"HOME=" + home, "PATH=/bin"}, Stdout: &out})
			if e != nil {
				t.Fatal(e)
			}
			if len(p.calls) != 3 || p.calls[0].Program != "npm" || p.calls[1].Args[0] != "run" || strings.Join(p.calls[2].Args, " ") != "rm --force "+p.calls[1].Args[4] {
				t.Fatalf("want server, player container, container removal: %+v", p.calls)
			}
			if envValue(p.calls[0].Env, "AGENT_ID") != "bram" || envValue(p.calls[0].Env, "EMERGENCE_MCP_HTTP_HOST") != "127.0.0.1" {
				t.Fatal("server must get its MCP env and bind loopback only", p.calls[0].Env)
			}
			if !p.tokenSet || !p.hungUp || out.String() != "final message" {
				t.Fatalf("token/login staged %v, server hung up %v, output %q", p.tokenSet, p.hungUp, out.String())
			}
			want := refreshed
			if refreshed == "not json" {
				want = `{"refresh":"old"}`
			}
			if b, _ := os.ReadFile(auth); string(b) != want {
				t.Fatalf("host login %s, want %s", b, want)
			}
		})
	}
}
