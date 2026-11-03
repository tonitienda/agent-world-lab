package episode

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tonitienda/agent-world-lab/internal/config"
	"github.com/tonitienda/agent-world-lab/internal/executor"
	"github.com/tonitienda/agent-world-lab/internal/harness"
	"github.com/tonitienda/agent-world-lab/internal/storage"
)

// gameHarness plays a fake round: it checks the isolation and writes the outcome the
// game's MCP server would write. wins[i] decides round i+1.
type gameHarness struct {
	t       *testing.T
	wins    []bool
	noFile  bool
	seeds   []string
	prompts []string
	scripts []string
}

func (g *gameHarness) Run(_ context.Context, r harness.Request) (executor.Result, error) {
	var m struct {
		MCPServers map[string]struct {
			Args []string          `json:"args"`
			Env  map[string]string `json:"env"`
		} `json:"mcpServers"`
	}
	if e := storage.ReadJSON(r.MCPConfig, &m); e != nil {
		g.t.Fatal(e)
	}
	server := m.MCPServers["agent-world"]
	env := server.Env
	session := env["SESSION_LOG_DIR"]
	if strings.HasPrefix(r.Dir, filepath.Dir(filepath.Dir(session))) {
		g.t.Fatal("gameplay cwd inside the privileged take folder")
	}
	for k := range env {
		if !strings.HasPrefix(k, "DETONARIUM_") && !strings.HasPrefix(k, "CHESS_") && k != "SESSION_LOG_DIR" && k != "AGENT_ID" && k != "AGENT_LABEL" {
			g.t.Fatalf("MCP env leaks %s", k)
		}
	}
	g.seeds = append(g.seeds, env["DETONARIUM_SEED"])
	g.prompts = append(g.prompts, r.Prompt)
	g.scripts = append(g.scripts, strings.Join(server.Args, " "))
	if !g.noFile {
		won := g.wins[len(g.seeds)-1]
		storage.JSON(filepath.Join(session, "outcome.json"), GameOutcome{Provider: "detonarium", Over: true, AgentWon: won, Detail: "fixture"})
	}
	return executor.Result{}, nil
}

func gameSetup(t *testing.T, edit func(string) string) (*App, string) {
	t.Helper()
	root := t.TempDir()
	a := New(root, io.Discard)
	a.Runner = &fixtureRunner{a: a}
	if e := a.InitProvider("episode-game", "detonarium"); e != nil {
		t.Fatal(e)
	}
	d := filepath.Join(root, "episodes/episode-game")
	if edit != nil {
		b, _ := os.ReadFile(filepath.Join(d, "episode.yaml"))
		os.WriteFile(filepath.Join(d, "episode.yaml"), []byte(edit(string(b))), 0600)
	}
	return a, d
}

func TestGameStartersLoad(t *testing.T) {
	for _, provider := range []string{"detonarium", "chess"} {
		a := New(t.TempDir(), io.Discard)
		if e := a.InitProvider("episode-x", provider); e != nil {
			t.Fatal(e)
		}
		c, e := config.Load(filepath.Join(a.Root, "episodes/episode-x"))
		if e != nil {
			t.Fatalf("%s starter: %v", provider, e)
		}
		if !c.Environment.Game() || c.Rounds != 3 || c.Production.Renderer != "replay" || strings.Join(c.Recording.Cameras, ",") != "board" {
			t.Fatalf("%s defaults: %+v", provider, c)
		}
		if _, e := os.Stat(filepath.Join(a.Root, "episodes/episode-x/level-design.md")); !os.IsNotExist(e) {
			t.Fatal("game episodes have no level design")
		}
	}
	if New(t.TempDir(), io.Discard).InitProvider("episode-y", "checkers") == nil {
		t.Fatal("unknown provider accepted")
	}
}

func TestGameConfigRejectsMixedOrMissingSettings(t *testing.T) {
	for name, edit := range map[string][2]string{
		"minecraft block":     {"provider: detonarium", "provider: detonarium\n  minecraft:\n    version: \"1.21.4\""},
		"preset":              {"provider: detonarium", "provider: detonarium\n  preset: survival"},
		"level design":        {"goal:", "level_design:\n  harness: claude\n  prompt: build\ngoal:"},
		"missing section":     {"  detonarium:\n", "  other_settings:\n"},
		"bad bot":             {"[hunter, hunter, hunter]", "[hunter, sniper]"},
		"too many bots":       {"[hunter, hunter, hunter]", "[hunter, hunter, hunter, hunter]"},
		"reach location":      {"type: win_rounds\n  wins: 1", "type: reach_location\n  target: x\n  radius: 4"},
		"wins above rounds":   {"wins: 1", "wins: 4"},
		"win_match 3 rounds":  {"type: win_rounds\n  wins: 1", "type: win_match"},
		"codex player":        {"harness: claude\n    model: claude-opus-5-5", "harness: codex\n    model: x"},
		"minecraft cameras":   {"recording:\n", "recording:\n  cameras: [agent-pov, observer, follow]\n"},
		"chess with deton.":   {"  detonarium:\n", "  chess:\n    side: white\n  detonarium:\n"},
		"rounds on minecraft": {"provider: detonarium", "provider: minecraft"},
	} {
		t.Run(name, func(t *testing.T) {
			_, d := gameSetup(t, func(s string) string {
				if !strings.Contains(s, edit[0]) {
					t.Fatalf("fixture text missing: %q", edit[0])
				}
				return strings.Replace(s, edit[0], edit[1], 1)
			})
			if _, e := config.Load(d); e == nil {
				t.Fatal("accepted invalid game configuration")
			}
		})
	}
}

func TestGameTakePlaysEveryRoundAndEvaluatesTrustedOutcomes(t *testing.T) {
	a, d := gameSetup(t, func(s string) string {
		s = strings.Replace(s, "seed: \"1\"", "seed: \"7\"", 1)
		return strings.Replace(s, "wins: 1", "wins: 2", 1)
	})
	os.WriteFile(filepath.Join(d, "goal.md"), []byte("Beat {{RIVALS}} rivals."), 0600)
	h := &gameHarness{t: t, wins: []bool{true, false, true}}
	a.Harness = h
	if e := a.RunAgent(context.Background(), "episode-game", Options{Agent: "claude", Take: "001"}); e != nil {
		t.Fatal(e)
	}
	if strings.Join(h.seeds, ",") != "7,8,9" {
		t.Fatalf("round seeds %v", h.seeds)
	}
	if h.prompts[0] != "Beat 3 rivals." || !strings.Contains(h.scripts[0], "run detonarium:mcp") {
		t.Fatalf("prompt %q, server %q", h.prompts[0], h.scripts[0])
	}
	var run Run
	if e := storage.ReadJSON(filepath.Join(d, "runs/claude/take-001/run.json"), &run); e != nil {
		t.Fatal(e)
	}
	if len(run.Rounds) != 3 || run.Infrastructure != "completed" || run.Objective.Outcome != "success" {
		t.Fatalf("%+v", run)
	}
	if a.RunAgent(context.Background(), "episode-game", Options{Agent: "claude", Take: "001"}) == nil {
		t.Fatal("overwrote a game take")
	}
	if a.Freeze(context.Background(), "episode-game", Options{}) == nil || a.Extract(context.Background(), "episode-game", Options{Agent: "claude", Take: "001"}) == nil {
		t.Fatal("Minecraft-only commands accepted a game episode")
	}
}

func TestGameRoundWithoutOutcomeIsAborted(t *testing.T) {
	a, d := gameSetup(t, nil)
	a.Harness = &gameHarness{t: t, noFile: true}
	if a.RunAgent(context.Background(), "episode-game", Options{Agent: "claude", Take: "001"}) == nil {
		t.Fatal("missing outcome.json accepted")
	}
	var run Run
	storage.ReadJSON(filepath.Join(d, "runs/claude/take-001/run.json"), &run)
	if run.Infrastructure != "aborted" || run.Objective.Outcome != "unknown" {
		t.Fatalf("%+v", run)
	}
}

func TestEvaluateRounds(t *testing.T) {
	c := config.Config{Rounds: 3}
	c.Evaluation.Type, c.Evaluation.Wins = "win_rounds", 2
	won := func(w bool) RoundResult { return RoundResult{Outcome: &GameOutcome{Over: true, AgentWon: w}} }
	for _, tt := range []struct {
		rounds []RoundResult
		want   string
	}{
		{nil, "unknown"},
		{[]RoundResult{won(true), won(true)}, "success"},
		{[]RoundResult{won(true), won(false)}, "incomplete"},
		{[]RoundResult{won(false), won(false)}, "failure"},
		{[]RoundResult{won(true), won(false), won(false)}, "failure"},
	} {
		if got := EvaluateRounds(c, tt.rounds).Outcome; got != tt.want {
			t.Fatalf("%d rounds: got %s, want %s", len(tt.rounds), got, tt.want)
		}
	}
}

func TestAgentLabel(t *testing.T) {
	if agentLabel("claude-opus-5-5") != "Claude Opus 5.5" || agentLabel("configured-default") != "Claude" {
		t.Fatal(agentLabel("claude-opus-5-5"))
	}
}

func TestGamePipelineAsksThenPlaysAndRendersEveryRound(t *testing.T) {
	a, d := gameSetup(t, nil)
	runner := a.Runner.(*fixtureRunner)
	h := &gameHarness{t: t, wins: []bool{false, true, false}}
	a.Harness = h
	yaml := filepath.Join(d, "episode.yaml")
	// Declining plays nothing.
	if a.Pipeline(context.Background(), yaml, PipelineOptions{Player: "claude", Input: strings.NewReader("n\n")}) == nil || len(h.seeds) != 0 {
		t.Fatal("played without approval")
	}
	if e := a.Pipeline(context.Background(), yaml, PipelineOptions{Player: "claude", Input: strings.NewReader("y\n")}); e != nil {
		t.Fatal(e)
	}
	if len(h.seeds) != 3 {
		t.Fatalf("played %d rounds", len(h.seeds))
	}
	var run Run
	storage.ReadJSON(filepath.Join(d, "runs/claude/take-001/run.json"), &run)
	if run.Objective.Outcome != "success" {
		t.Fatalf("%+v", run.Objective)
	}
	// The fixture harness writes no replay, so rendering skips every round without calling npm.
	for _, q := range runner.calls {
		if strings.Contains(strings.Join(q.Args, " "), "detonarium:record") {
			t.Fatal("rendered a round that has no replay")
		}
	}
	// Resuming the same take renders rounds that now have replays, never replays the game.
	for n := 1; n <= 3; n++ {
		storage.Write(filepath.Join(d, "runs/claude/take-001", "round-"+string(rune('0'+n)), "session/replay.json"), []byte("{}"))
	}
	if e := a.Pipeline(context.Background(), yaml, PipelineOptions{Player: "claude", Input: strings.NewReader("")}); e != nil {
		t.Fatal(e)
	}
	renders := 0
	for _, q := range runner.calls {
		if strings.Contains(strings.Join(q.Args, " "), "detonarium:record") {
			renders++
		}
	}
	if len(h.seeds) != 3 || renders != 3 {
		t.Fatalf("resume replayed %d rounds and rendered %d", len(h.seeds), renders)
	}
}
