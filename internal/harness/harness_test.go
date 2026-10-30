package harness

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"slices"
	"strings"
	"testing"

	"github.com/tonitienda/agent-world-lab/internal/executor"
)

type fake struct {
	q   executor.Request
	err error
}

func (f *fake) Run(_ context.Context, q executor.Request) (executor.Result, error) {
	f.q = q
	return executor.Result{ExitCode: 7}, f.err
}
func TestArgumentsAndPromptIsolation(t *testing.T) {
	for _, h := range []string{"claude", "codex"} {
		q, e := Command(Request{Harness: h, Model: "model-future", Prompt: "secret\nexact", Dir: "/tmp/designer", Output: "/tmp/output"})
		if e != nil {
			t.Fatal(e)
		}
		args := strings.Join(q.Args, " ")
		if !strings.Contains(args, "--model model-future") {
			t.Fatal(args)
		}
		b, _ := io.ReadAll(q.Stdin)
		if string(b) != "secret\nexact" {
			t.Fatal(string(b))
		}
		if strings.Contains(args, "secret") {
			t.Fatal("prompt leaked to argv")
		}
	}
	q, e := Command(Request{Harness: "claude", Player: true, MCPConfig: "/tmp/mcp.json", Model: "configured-default"})
	if e != nil {
		t.Fatal(e)
	}
	args := strings.Join(q.Args, "|")
	for _, s := range []string{"--tools||", "--restricted", "--strict-mcp-config", "--disable-slash-commands", "--no-chrome", "--settings", "--no-session-persistence", "mcp__agent-world__*"} {
		if !strings.Contains(args, s) {
			t.Fatal(args)
		}
	}
	if slices.Contains(q.Args, "--bare") || slices.Contains(q.Args, "--safe-mode") {
		t.Fatal("OAuth or explicit MCP disabled", q.Args)
	}
	var settings struct {
		DisableAllHooks   bool     `json:"disableAllHooks"`
		AutoMemoryEnabled bool     `json:"autoMemoryEnabled"`
		ClaudeMDExcludes  []string `json:"claudeMdExcludes"`
	}
	settingsAt := slices.Index(q.Args, "--settings")
	if settingsAt < 0 || json.Unmarshal([]byte(q.Args[settingsAt+1]), &settings) != nil || !settings.DisableAllHooks || settings.AutoMemoryEnabled || !slices.Contains(settings.ClaudeMDExcludes, "**") {
		t.Fatal("missing context isolation", q.Args)
	}
	if strings.Contains(args, "--model") {
		t.Fatal("configured default incorrectly forwarded")
	}
	if _, e = Command(Request{Harness: "codex", Player: true}); e == nil {
		t.Fatal("unisolated gameplay allowed")
	}
}
func TestHarnessFailure(t *testing.T) {
	want := errors.New("auth unavailable")
	f := &fake{err: want}
	_, e := (CLI{Runner: f}).Run(context.Background(), Request{Harness: "claude"})
	if !errors.Is(e, want) {
		t.Fatal(e)
	}
}

type checker struct {
	auth  string
	help  string
	calls int
}

func (c *checker) Run(_ context.Context, q executor.Request) (executor.Result, error) {
	c.calls++
	text := c.help
	if slices.Contains(q.Args, "auth") {
		text = c.auth
	}
	if q.Stdout != nil {
		io.WriteString(q.Stdout, text)
	}
	return executor.Result{}, nil
}
func TestPlayerChecksFlagsAndAuthentication(t *testing.T) {
	flags := "--print --restricted --settings --disable-slash-commands --no-chrome --tools --strict-mcp-config --setting-sources --no-session-persistence"
	for _, tt := range []struct {
		help, auth string
		valid      bool
	}{{flags, `{"loggedIn":true}`, true}, {flags, `{"loggedIn":false}`, false}, {flags, `not json`, false}, {"--print", `{"loggedIn":true}`, false}} {
		r := &checker{help: tt.help, auth: tt.auth}
		e := (CLI{Runner: r}).Check(context.Background(), Request{Harness: "claude", Player: true})
		if (e == nil) != tt.valid {
			t.Fatal(e)
		}
	}
}

func TestAuthPreflightUsesSameAuthenticationFlagsAsSession(t *testing.T) {
	r := &checker{help: "--print --restricted --settings --disable-slash-commands --no-chrome --tools --strict-mcp-config --setting-sources --no-session-persistence", auth: `{"loggedIn":true}`}
	spy := &authSpy{checker: r}
	if e := (CLI{Runner: spy}).Check(context.Background(), Request{Harness: "claude", Player: true}); e != nil {
		t.Fatal(e)
	}
	prefix := ClaudeIsolationArgs()
	if len(spy.authArgs) < len(prefix) || !slices.Equal(spy.authArgs[:len(prefix)], prefix) {
		t.Fatal("preflight and player authentication flags differ", spy.authArgs)
	}
	if slices.Contains(spy.authArgs, "--bare") || slices.Contains(spy.authArgs, "--safe-mode") {
		t.Fatal("auth preflight disables subscription auth or MCP")
	}
}

type authSpy struct {
	*checker
	authArgs []string
}

func (s *authSpy) Run(ctx context.Context, q executor.Request) (executor.Result, error) {
	if slices.Contains(q.Args, "auth") {
		s.authArgs = append([]string{}, q.Args...)
	}
	return s.checker.Run(ctx, q)
}
