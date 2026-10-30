// Package harness adapts installed Claude Code and Codex executables.
package harness

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/tonitienda/agent-world-lab/internal/executor"
)

type Request struct {
	Harness, Model, Dir, Prompt, MCPConfig, Output string
	Player                                         bool
	Env                                            []string
	Stdout, Stderr                                 io.Writer
	OnCancel                                       func()
}
type Harness interface {
	Run(context.Context, Request) (executor.Result, error)
}
type CLI struct{ Runner executor.Runner }

// ClaudeIsolationArgs preserves normal OAuth/keychain authentication. --bare
// disables that authentication; --safe-mode also disables explicitly configured
// MCP servers. Use explicit customization controls with restricted MCP-only tools.
func ClaudeIsolationArgs() []string {
	return []string{"--restricted", "--setting-sources", "", "--settings", `{"disableAllHooks":true,"autoMemoryEnabled":false,"claudeMdExcludes":["**"]}`, "--disable-slash-commands", "--no-chrome", "--strict-mcp-config"}
}

func Command(r Request) (executor.Request, error) {
	q := executor.Request{Program: r.Harness, Dir: r.Dir, Env: r.Env, Stdin: strings.NewReader(r.Prompt), Stdout: r.Stdout, Stderr: r.Stderr, OnCancel: r.OnCancel}
	switch r.Harness {
	case "claude":
		q.Args = append(ClaudeIsolationArgs(), "--print", "--no-session-persistence", "--permission-mode", "dontAsk", "--tools", "")
		if r.Player {
			q.Args = append(q.Args, "--mcp-config", r.MCPConfig, "--allowedTools", "mcp__agent-world__*")
		} else {
			q.Args = append(q.Args, "--mcp-config", `{"mcpServers":{}}`)
		}
	case "codex":
		if r.Player {
			return q, fmt.Errorf("Codex gameplay blocked: read-only sandbox still permits privileged filesystem reads; use the MCP-only Claude adapter or implement an external container isolation boundary")
		}
		q.Args = []string{"exec", "--ignore-user-config", "--ignore-rules", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "--disable", "shell_tool", "--disable", "unified_exec", "--disable", "apps", "--disable", "plugins", "--disable", "multi_agent", "--disable", "view_image", "-c", "web_search=\"disabled\"", "--output-last-message", r.Output, "-"}
	default:
		return q, fmt.Errorf("unsupported harness %q", r.Harness)
	}
	if r.Model != "" && r.Model != "configured-default" {
		q.Args = append(q.Args, "--model", r.Model)
	}
	return q, nil
}
func (c CLI) Run(ctx context.Context, r Request) (executor.Result, error) {
	q, e := Command(r)
	if e != nil {
		return executor.Result{}, e
	}
	return c.Runner.Run(ctx, q)
}

// Check refuses unsupported isolation flags and unauthenticated players before a
// destructive world restore. Help output and account JSON are never logged.
func (c CLI) Check(ctx context.Context, r Request) error {
	if _, e := Command(r); e != nil {
		return e
	}
	timeout, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	var out bytes.Buffer
	if _, e := c.Runner.Run(timeout, executor.Request{Program: r.Harness, Args: []string{"--help"}, Dir: r.Dir, Env: r.Env, Stdout: &out}); e != nil {
		return e
	}
	required := []string{"--print", "--restricted", "--settings", "--disable-slash-commands", "--no-chrome", "--tools", "--strict-mcp-config", "--setting-sources", "--no-session-persistence"}
	if r.Harness == "codex" {
		return nil
	} // exec's supported flags are checked by execution in a read-only designer workspace.
	for _, flag := range required {
		if !strings.Contains(out.String(), flag) {
			return fmt.Errorf("installed Claude CLI lacks %s; update it before an isolated run", flag)
		}
	}
	if r.Player {
		out.Reset()
		// auth status does not start MCP servers. Do not put --mcp-config
		// before the subcommand: its variadic argument consumes "auth status".
		if _, e := c.Runner.Run(timeout, executor.Request{Program: "claude", Args: append(ClaudeIsolationArgs(), "auth", "status", "--json"), Dir: r.Dir, Env: r.Env, Stdout: &out}); e != nil {
			return fmt.Errorf("Claude authentication unavailable; run claude auth login before restoring a world: %w", e)
		}
		var status struct {
			LoggedIn bool `json:"loggedIn"`
		}
		if e := json.Unmarshal(out.Bytes(), &status); e != nil || !status.LoggedIn {
			return fmt.Errorf("Claude is not authenticated for unattended use; run claude auth login before restoring a world")
		}
	}
	return nil
}
