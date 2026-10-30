package harness

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tonitienda/agent-world-lab/internal/executor"
)

// Opt-in test: the real installed Claude CLI talks only to a local dummy model
// endpoint and a stdio fixture world. No login, model billing or Minecraft needed.
func TestRealClaudeOAuthCompatibleIsolation(t *testing.T) {
	if os.Getenv("EMERGENCE_REAL_CLAUDE_TEST") != "1" {
		t.Skip("set EMERGENCE_REAL_CLAUDE_TEST=1 to test the installed Claude CLI against a local mock")
	}
	cli, e := exec.LookPath("claude")
	if e != nil {
		t.Fatal(e)
	}
	root := t.TempDir()
	home := filepath.Join(root, "home")
	work := filepath.Join(root, "work")
	for _, d := range []string{filepath.Join(home, ".claude"), work} {
		if e = os.MkdirAll(d, 0700); e != nil {
			t.Fatal(e)
		}
	}
	markers := map[string]string{filepath.Join(home, ".claude/CLAUDE.md"): "PRIVATE_HOME_SENTINEL", filepath.Join(root, "CLAUDE.md"): "PRIVATE_PARENT_SENTINEL", filepath.Join(work, "CLAUDE.md"): "PRIVATE_WORK_SENTINEL"}
	for p, m := range markers {
		os.WriteFile(p, []byte(m), 0600)
	}
	called := filepath.Join(root, "world-tool-called")
	mcp := filepath.Join(root, "mcp.json")
	b, _ := json.Marshal(map[string]any{"mcpServers": map[string]any{"agent-world": map[string]any{"command": os.Args[0], "args": []string{"-test.run=TestClaudeMCPFixtureProcess"}, "env": map[string]string{"EMERGENCE_MCP_HELPER": "1", "EMERGENCE_MCP_CALLED": called}}}})
	os.WriteFile(mcp, b, 0600)
	var mu sync.Mutex
	tools := map[string]bool{}
	private := false
	observed := false
	sent := false
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		defer r.Body.Close()
		if !strings.HasPrefix(r.URL.Path, "/v1/messages") {
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, "{}")
			return
		}
		var q struct {
			Stream bool `json:"stream"`
			Tools  []struct {
				Name string `json:"name"`
			} `json:"tools"`
		}
		if json.Unmarshal(raw, &q) != nil {
			http.Error(w, "invalid fixture request", 400)
			return
		}
		mu.Lock()
		for _, m := range markers {
			private = private || strings.Contains(string(raw), m)
		}
		observed = observed || strings.Contains(string(raw), "fixture-world-observation")
		tool := ""
		for _, item := range q.Tools {
			tools[item.Name] = true
			if strings.HasSuffix(item.Name, "__observe") {
				tool = item.Name
			}
		}
		useTool := tool != "" && !sent
		if useTool {
			sent = true
		}
		mu.Unlock()
		block := map[string]any{"type": "text", "text": "fixture-complete"}
		stop := "end_turn"
		if useTool {
			block = map[string]any{"type": "tool_use", "id": "toolu_fixture", "name": tool, "input": map[string]any{}}
			stop = "tool_use"
		}
		message := map[string]any{"id": "msg_fixture", "type": "message", "role": "assistant", "model": "fixture-model", "content": []any{block}, "stop_reason": stop, "stop_sequence": nil, "usage": map[string]int{"input_tokens": 1, "output_tokens": 1}}
		if !q.Stream {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(message)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		emit := func(kind string, data any) {
			b, _ := json.Marshal(data)
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", kind, b)
		}
		initial := map[string]any{"id": "msg_fixture", "type": "message", "role": "assistant", "model": "fixture-model", "content": []any{}, "stop_reason": nil, "stop_sequence": nil, "usage": map[string]int{"input_tokens": 1, "output_tokens": 0}}
		emit("message_start", map[string]any{"type": "message_start", "message": initial})
		start := map[string]any{"type": "text", "text": ""}
		delta := map[string]any{"type": "text_delta", "text": "fixture-complete"}
		if useTool {
			start = map[string]any{"type": "tool_use", "id": "toolu_fixture", "name": tool, "input": map[string]any{}}
			delta = map[string]any{"type": "input_json_delta", "partial_json": "{}"}
		}
		emit("content_block_start", map[string]any{"type": "content_block_start", "index": 0, "content_block": start})
		emit("content_block_delta", map[string]any{"type": "content_block_delta", "index": 0, "delta": delta})
		emit("content_block_stop", map[string]any{"type": "content_block_stop", "index": 0})
		emit("message_delta", map[string]any{"type": "message_delta", "delta": map[string]any{"stop_reason": stop, "stop_sequence": nil}, "usage": map[string]int{"output_tokens": 1}})
		emit("message_stop", map[string]any{"type": "message_stop"})
	}))
	defer api.Close()
	env := []string{"PATH=" + filepath.Dir(cli) + string(os.PathListSeparator) + os.Getenv("PATH"), "HOME=" + home, "LANG=en_US.UTF-8", "TMPDIR=" + root, "ANTHROPIC_API_KEY=fixture-key-not-a-real-credential", "ANTHROPIC_BASE_URL=" + api.URL, "DISABLE_TELEMETRY=1", "DISABLE_ERROR_REPORTING=1", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1"}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	launcher := CLI{Runner: executor.OS{Grace: time.Second}}
	if e = launcher.Check(ctx, Request{Harness: "claude", Player: true, Dir: work, Env: env}); e != nil {
		t.Fatalf("real Claude authentication preflight: %v", e)
	}
	var stdout, stderr strings.Builder
	_, e = launcher.Run(ctx, Request{Harness: "claude", Model: "fixture-model", Player: true, Dir: work, Prompt: "Use the fixture world observe tool and finish.", MCPConfig: mcp, Env: env, Stdout: &stdout, Stderr: &stderr})
	if e != nil {
		t.Fatalf("real Claude fixture: %v\n%s", e, stderr.String())
	}
	if _, e = os.Stat(called); e != nil {
		t.Fatalf("explicit world MCP tool was not called; stdout=%s stderr=%s", stdout.String(), stderr.String())
	}
	mu.Lock()
	defer mu.Unlock()
	if private {
		t.Fatal("private CLAUDE.md instructions reached the model")
	}
	if !observed {
		t.Fatal("fixture world observation did not return to the model")
	}
	for name := range tools {
		if name != "DeferredToolPlaceholder" && name != "mcp__agent-world__observe" {
			t.Errorf("unexpected model capability %s", name)
		}
	}
	if !tools["mcp__agent-world__observe"] {
		t.Fatal("world tool missing")
	}
}

// Minimal MCP JSON-RPC fixture, invoked only as a subprocess by the opt-in test.
func TestClaudeMCPFixtureProcess(t *testing.T) {
	if os.Getenv("EMERGENCE_MCP_HELPER") != "1" {
		return
	}
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 4096), 4*1024*1024)
	out := json.NewEncoder(os.Stdout)
	for scanner.Scan() {
		var request struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
			Params struct {
				ProtocolVersion string `json:"protocolVersion"`
			} `json:"params"`
		}
		if json.Unmarshal(scanner.Bytes(), &request) != nil || len(request.ID) == 0 {
			continue
		}
		var result any = map[string]any{}
		switch request.Method {
		case "initialize":
			result = map[string]any{"protocolVersion": request.Params.ProtocolVersion, "capabilities": map[string]any{"tools": map[string]any{}}, "serverInfo": map[string]string{"name": "fixture-world", "version": "1.0.0"}}
		case "tools/list":
			result = map[string]any{"tools": []any{map[string]any{"name": "observe", "description": "Observe the disposable fixture world", "inputSchema": map[string]any{"type": "object", "properties": map[string]any{}}}}}
		case "tools/call":
			os.WriteFile(os.Getenv("EMERGENCE_MCP_CALLED"), []byte("called"), 0600)
			result = map[string]any{"content": []any{map[string]string{"type": "text", "text": "fixture-world-observation"}}}
		}
		out.Encode(map[string]any{"jsonrpc": "2.0", "id": request.ID, "result": result})
	}
	os.Exit(0)
}
