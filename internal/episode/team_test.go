package episode

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/tonitienda/agent-world-lab/internal/executor"
	"github.com/tonitienda/agent-world-lab/internal/harness"
	"github.com/tonitienda/agent-world-lab/internal/storage"
)

// teamHarness plays every seat of a team take concurrently, placing each
// member at the position chosen for it.
type teamHarness struct {
	mu        sync.Mutex
	positions map[string]Point
	env       map[string]map[string]string
	prompts   map[string]string
}

func (h *teamHarness) Run(_ context.Context, r harness.Request) (executor.Result, error) {
	var m struct {
		MCPServers map[string]struct {
			Env map[string]string `json:"env"`
		} `json:"mcpServers"`
	}
	storage.ReadJSON(r.MCPConfig, &m)
	env := m.MCPServers["agent-world"].Env
	player := env["AGENT_ID"]
	h.mu.Lock()
	h.env[player], h.prompts[player] = env, r.Prompt
	h.mu.Unlock()
	dest := filepath.Dir(env["RECORD_MP4"])
	for _, name := range []string{"metadata.json", "agent-pov.mp4", "observer.mp4", "follow.mp4"} {
		storage.Write(filepath.Join(dest, name), []byte("fixture artifact"))
	}
	storage.JSON(filepath.Join(dest, "mcp-session.json"), map[string]string{"outcome": "completed", "reason": "agent_finished"})
	storage.JSON(filepath.Join(dest, "events.json"), observations(h.positions[player]))
	return executor.Result{ExitCode: 0}, nil
}

func teamFixture(t *testing.T) (*App, *fixtureRunner, string) {
	t.Helper()
	a, r, d := setup(t)
	b, _ := os.ReadFile(filepath.Join(d, "episode.yaml"))
	yaml := strings.Replace(string(b), "  - id: claude\n", "  - id: claude\n    goal_file: role-claude.md\n", 1)
	yaml = strings.Replace(yaml, "  - id: codex\n", "  - id: codex\n    goal_file: role-codex.md\n", 1)
	yaml = strings.Replace(yaml, "recording:", "play: together\nrecording:", 1)
	storage.Write(filepath.Join(d, "episode.yaml"), []byte(yaml))
	storage.Write(filepath.Join(d, "role-claude.md"), []byte("You hold the wood.\n"))
	storage.Write(filepath.Join(d, "role-codex.md"), []byte("You know the gate.\n"))
	m := Manifest{Version: 1, Spawn: Point{0.5, 80, 0.5}, Spawns: map[string]Point{"claude": {0.5, 80, 0.5}, "codex": {20.5, 80, 0.5}}, Targets: map[string]Point{"mainland-landmark": {40, 80, 0}}, Install: "implementation/install.mjs", Verify: "implementation/verify.mjs", Revision: "team-v1"}
	mb, _ := json.Marshal(m)
	p := filepath.Join(d, "bundle.json")
	storage.JSON(p, map[string]any{"files": map[string]string{"manifest.json": string(mb), "implementation/install.mjs": "// reviewed install\n", "implementation/verify.mjs": "// reviewed verification\n", "report.md": "Manual reachability review remains.\n"}})
	if e := a.Generate(context.Background(), "episode-test", p, Options{}); e != nil {
		t.Fatal(e)
	}
	_, hash, e := manifest(filepath.Join(d, "scenario"), mustConfig(t, d))
	if e != nil {
		t.Fatal(e)
	}
	if e := a.ValidateScenario(context.Background(), "episode-test", Options{Yes: true, Approval: hash}); e != nil {
		t.Fatal(e)
	}
	if e := a.Freeze(context.Background(), "episode-test", Options{}); e != nil {
		t.Fatal(e)
	}
	return a, r, d
}

func TestTeamTakeSeatsEveryMemberInOneWorld(t *testing.T) {
	a, r, d := teamFixture(t)
	installed := false
	for _, call := range r.calls {
		for _, env := range call.Env {
			installed = installed || env == "EMERGENCE_PLAYERS=claude,codex"
		}
	}
	if !installed {
		t.Fatal("install/verify must be told every team player")
	}
	h := &teamHarness{positions: map[string]Point{"claude": {40, 80, 0}, "codex": {41, 80, 0}}, env: map[string]map[string]string{}, prompts: map[string]string{}}
	a.Harness = h
	if e := a.RunAgent(context.Background(), "episode-test", Options{Agent: "claude", Yes: true}); e == nil {
		t.Fatal("a together episode must not run one agent alone")
	}
	if e := a.RunAgent(context.Background(), "episode-test", Options{Yes: true}); e != nil {
		t.Fatal(e)
	}
	var run Run
	if e := storage.ReadJSON(filepath.Join(d, "runs/team/take-001/run.json"), &run); e != nil {
		t.Fatal(e)
	}
	if run.Agent != "team" || run.Infrastructure != "completed" || len(run.Members) != 2 {
		t.Fatalf("%+v", run)
	}
	ports := map[string]bool{}
	for _, member := range []string{"claude", "codex"} {
		env := h.env[member]
		if env["EMERGENCE_CONTROL_ID"] != member || !strings.HasSuffix(filepath.Dir(env["RECORD_MP4"]), filepath.Join("runs/team/take-001", member)) {
			t.Fatalf("%s needs its own control files and camera folder: %v", member, env)
		}
		ports[env["RECORD_VIEWER_PORT"]] = true
		if env["RECORD_WIDTH"] != "1280" || env["RECORD_HEIGHT"] != "720" || env["RECORD_FPS"] != "30" {
			t.Fatalf("%s seat must capture at the shared-CPU budget 720p30: %v", member, env)
		}
		if !strings.HasPrefix(h.prompts[member], "You ") || !strings.Contains(h.prompts[member], "Narration style") {
			t.Fatalf("%s must receive its role brief then the shared goal: %q", member, h.prompts[member])
		}
	}
	if len(ports) != 2 {
		t.Fatal("seats share recorder viewer ports")
	}
	if !strings.Contains(h.env["codex"]["EMERGENCE_EXPECTED_START"], "20.5") {
		t.Fatal("member must start at its own manifest spawn")
	}
	for _, member := range run.Members {
		if member.Objective.Outcome != "success" {
			t.Fatalf("member objective evaluated from its own events: %+v", member)
		}
	}
}

// Casting is presentation: characters added after the freeze keep the frozen
// world valid, every seat gets the whole cast and each prompt gets its voice.
func TestTeamTakeDressesEveryMemberAsItsCharacter(t *testing.T) {
	a, _, d := teamFixture(t)
	b, _ := os.ReadFile(filepath.Join(d, "episode.yaml"))
	yaml := strings.Replace(string(b), "    goal_file: role-claude.md\n", "    goal_file: role-claude.md\n    character: ada\n", 1)
	yaml = strings.Replace(yaml, "    goal_file: role-codex.md\n", "    goal_file: role-codex.md\n    character: bram\n", 1)
	storage.Write(filepath.Join(d, "episode.yaml"), []byte(yaml))
	h := &teamHarness{positions: map[string]Point{"claude": {40, 80, 0}, "codex": {41, 80, 0}}, env: map[string]map[string]string{}, prompts: map[string]string{}}
	a.Harness = h
	if e := a.RunAgent(context.Background(), "episode-test", Options{Yes: true}); e != nil {
		t.Fatal(e)
	}
	for member, want := range map[string]string{"claude": "On screen you are Ada", "codex": "On screen you are Bram"} {
		var cast map[string]struct{ Character, Label, Accent, Skin string }
		if e := json.Unmarshal([]byte(h.env[member]["EMERGENCE_CAST"]), &cast); e != nil {
			t.Fatalf("%s: %v", member, e)
		}
		if cast["claude"].Label != "Ada · Claude" || cast["codex"].Label != "Bram · Codex" || cast["codex"].Accent != "#10a37f" {
			t.Fatalf("%s must see the whole cast keyed by username: %+v", member, cast)
		}
		if !strings.HasSuffix(cast["claude"].Skin, filepath.Join("characters", "skins", "ada.png")) {
			t.Fatalf("skin path: %q", cast["claude"].Skin)
		}
		if !strings.Contains(h.prompts[member], want) {
			t.Fatalf("%s prompt lacks its character voice: %q", member, h.prompts[member])
		}
	}
}

func TestTeamObjective(t *testing.T) {
	member := func(outcome string) MemberRun {
		return MemberRun{Agent: outcome, Objective: Evaluation{Outcome: outcome, Evidence: "fixture"}}
	}
	for _, tt := range []struct {
		name    string
		members []MemberRun
		want    string
	}{
		{"everyone arrived", []MemberRun{member("success"), member("success")}, "success"},
		{"one stayed behind", []MemberRun{member("success"), member("failure")}, "failure"},
		{"one timed out short of the shrine", []MemberRun{member("success"), member("incomplete")}, "incomplete"},
		{"one has no trusted observations", []MemberRun{member("success"), member("unknown")}, "unknown"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if got := teamObjective(tt.members); got.Outcome != tt.want || got.Evidence == "" {
				t.Fatalf("got %+v, want %s with evidence", got, tt.want)
			}
		})
	}
}
