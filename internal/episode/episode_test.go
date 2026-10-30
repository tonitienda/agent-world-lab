package episode

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tonitienda/agent-world-lab/internal/executor"
	"github.com/tonitienda/agent-world-lab/internal/harness"
	"github.com/tonitienda/agent-world-lab/internal/storage"
)

type fixtureRunner struct {
	a         *App
	calls     []executor.Request
	fail      string
	onRestore func()
}

func (f *fixtureRunner) Run(_ context.Context, q executor.Request) (executor.Result, error) {
	f.calls = append(f.calls, q)
	joined := strings.Join(q.Args, " ")
	if f.fail != "" && strings.Contains(joined, f.fail) {
		return executor.Result{ExitCode: 1}, errors.New("injected subprocess failure")
	}
	if strings.Contains(joined, "emergence-environment.ts") {
		var r map[string]any
		if e := storage.ReadJSON(q.Args[len(q.Args)-1], &r); e != nil {
			return executor.Result{}, e
		}
		switch q.Args[len(q.Args)-2] {
		case "restore":
			if f.onRestore != nil {
				f.onRestore()
			}
		case "lease":
			storage.JSON(filepath.Join(f.a.Root, "data/active-session.lock/owner.json"), map[string]any{"pid": r["pid"], "kind": "emergence session orchestration", "token": r["token"]})
		case "snapshot":
			p := r["destination"].(string)
			storage.Write(filepath.Join(p, "world/world/level.dat"), []byte("disposable fake world"))
		}
	}
	for _, env := range q.Env {
		if strings.HasPrefix(env, "EMERGENCE_VALIDATION_REPORT=") {
			storage.JSON(strings.TrimPrefix(env, "EMERGENCE_VALIDATION_REPORT="), map[string]any{"spawn": true, "target": true, "resources": true, "capabilities": true, "recorder": true, "reachability": "manual", "evidence": []string{"fixture checks"}})
		}
	}
	return executor.Result{}, nil
}

type fixtureHarness struct {
	t     *testing.T
	fail  error
	goal  string
	calls int
}

func (f *fixtureHarness) Run(_ context.Context, r harness.Request) (executor.Result, error) {
	f.calls++
	if r.Prompt != f.goal {
		f.t.Fatal("player received non-goal context")
	}
	var m struct {
		MCPServers map[string]struct {
			Env map[string]string `json:"env"`
		} `json:"mcpServers"`
	}
	if e := storage.ReadJSON(r.MCPConfig, &m); e != nil {
		f.t.Fatal(e)
	}
	env := m.MCPServers["agent-world"].Env
	if env["RECORD_WIDTH"] != "3840" || env["RECORD_HEIGHT"] != "2160" || env["RECORD_FPS"] != "60" {
		f.t.Fatal("recorded takes must request provider-independent 4K/60 capture")
	}
	if env["SCENARIO_FILE"] != "" {
		f.t.Fatal("hidden scenario exposed")
	}
	dest := filepath.Dir(env["RECORD_MP4"])
	if strings.HasPrefix(r.Dir, filepath.Dir(dest)) {
		f.t.Fatal("gameplay cwd in privileged episode")
	}
	for _, name := range []string{"metadata.json", "agent-pov.mp4", "observer.mp4", "follow.mp4"} {
		storage.Write(filepath.Join(dest, name), []byte("fixture artifact"))
	}
	storage.JSON(filepath.Join(dest, "mcp-session.json"), map[string]string{"outcome": "completed", "reason": "agent_finished"})
	storage.JSON(filepath.Join(dest, "events.json"), []any{map[string]any{"action": "objective_observation", "details": map[string]any{"result": map[string]any{"position": Point{40, 80, 0}}}}})
	return executor.Result{ExitCode: 0}, f.fail
}
func setup(t *testing.T) (*App, *fixtureRunner, string) {
	t.Helper()
	root := t.TempDir()
	t.Cleanup(func() {
		filepath.WalkDir(root, func(p string, d os.DirEntry, e error) error {
			if e == nil {
				os.Chmod(p, 0700)
			}
			return nil
		})
	})
	a := New(root, io.Discard)
	r := &fixtureRunner{a: a}
	a.Runner = r
	if e := a.Init("episode-test"); e != nil {
		t.Fatal(e)
	}
	return a, r, filepath.Join(root, "episodes/episode-test")
}
func bundle(t *testing.T, d string) string {
	t.Helper()
	m := Manifest{Version: 1, Spawn: Point{0.5, 80, 0.5}, Targets: map[string]Point{"mainland-landmark": {40, 80, 0}}, Install: "implementation/install.mjs", Verify: "implementation/verify.mjs", Revision: "fixture-v1"}
	b, _ := json.Marshal(m)
	p := filepath.Join(d, "bundle.json")
	if e := storage.JSON(p, map[string]any{"files": map[string]string{"manifest.json": string(b), "implementation/install.mjs": "// reviewed install\n", "implementation/verify.mjs": "// reviewed verification\n", "report.md": "Manual reachability review remains.\n"}}); e != nil {
		t.Fatal(e)
	}
	return p
}
func generate(t *testing.T, a *App, d string) string {
	t.Helper()
	if e := a.Generate(context.Background(), "episode-test", bundle(t, d), Options{}); e != nil {
		t.Fatal(e)
	}
	_, hash, e := manifest(filepath.Join(d, "scenario"), mustConfig(t, d))
	if e != nil {
		t.Fatal(e)
	}
	return hash
}

type designerHarness func(harness.Request) error

func (f designerHarness) Run(_ context.Context, r harness.Request) (executor.Result, error) {
	return executor.Result{}, f(r)
}

func TestDesignerReceivesConfiguredEvaluationTarget(t *testing.T) {
	a, runner, d := setup(t)
	yamlPath := filepath.Join(d, "episode.yaml")
	yaml, e := os.ReadFile(yamlPath)
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(yamlPath, []byte(strings.ReplaceAll(string(yaml), "mainland-landmark", "gold-landing-pad")), 0600); e != nil {
		t.Fatal(e)
	}
	content, e := os.ReadFile(bundle(t, d))
	if e != nil {
		t.Fatal(e)
	}
	content = []byte(strings.ReplaceAll(string(content), "mainland-landmark", "gold-landing-pad"))
	called := false
	a.Harness = designerHarness(func(r harness.Request) error {
		called = true
		for _, required := range []string{`"target":"gold-landing-pad"`, `"radius":4`, `"preset":"survival"`, `"minecraft_version":"1.21.4"`, `"targets":{"gold-landing-pad"`, "actual destination built by install and checked by verify"} {
			if !strings.Contains(r.Prompt, required) {
				t.Errorf("designer missing configuration %s", required)
			}
		}
		if strings.Contains(r.Prompt, "mainland-landmark") {
			t.Error("unrelated example target leaked into designer contract")
		}
		if r.Player {
			t.Fatal("designer invoked as player")
		}
		if r.Harness == "codex" {
			return os.WriteFile(r.Output, content, 0600)
		}
		_, e := r.Stdout.Write(content)
		return e
	})
	if e = a.Generate(context.Background(), "episode-test", "", Options{}); e != nil {
		t.Fatal(e)
	}
	if !called || len(runner.calls) != 0 {
		t.Fatal("expected designer invocation without world operations")
	}
}

func TestRejectedDesignerTargetLeavesScenarioUninstalled(t *testing.T) {
	a, runner, d := setup(t)
	p := bundle(t, d)
	content, e := os.ReadFile(p)
	if e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(p, []byte(strings.ReplaceAll(string(content), "mainland-landmark", "wrong-target")), 0600); e != nil {
		t.Fatal(e)
	}
	e = a.Generate(context.Background(), "episode-test", p, Options{})
	if e == nil || !strings.Contains(e.Error(), `evaluation.target "mainland-landmark" from episode.yaml`) || !strings.Contains(e.Error(), "rerun generation") {
		t.Fatalf("expected actionable target error, got %v", e)
	}
	if _, e = os.Stat(filepath.Join(d, "scenario")); !os.IsNotExist(e) || len(runner.calls) != 0 {
		t.Fatal("rejected scenario installed or changed the world")
	}
}

func TestInitStaticAndOverwrite(t *testing.T) {
	a, r, d := setup(t)
	if e := a.Validate("episode-test"); e != nil {
		t.Fatal(e)
	}
	if len(r.calls) != 0 {
		t.Fatal("static validation executed subprocess")
	}
	before, _ := os.ReadFile(filepath.Join(d, "goal.md"))
	if a.Init("episode-test") == nil {
		t.Fatal("overwrote episode")
	}
	after, _ := os.ReadFile(filepath.Join(d, "goal.md"))
	if string(before) != string(after) {
		t.Fatal("changed existing goal")
	}
	if a.Init("../escape") == nil {
		t.Fatal("path escape")
	}
}
func TestScenarioLifecycleAndResume(t *testing.T) {
	a, r, d := setup(t)
	hash := generate(t, a, d)
	if len(r.calls) != 0 {
		t.Fatal("generation executed code")
	}
	if a.ValidateScenario(context.Background(), "episode-test", Options{Yes: true, Approval: "wrong"}) == nil {
		t.Fatal("unapproved execution")
	}
	if len(r.calls) != 0 {
		t.Fatal("unauthorized commands")
	}
	if e := a.ValidateScenario(context.Background(), "episode-test", Options{Yes: true, Approval: hash}); e != nil {
		t.Fatal(e)
	}
	n := len(r.calls)
	if e := a.ValidateScenario(context.Background(), "episode-test", Options{}); e != nil {
		t.Fatal(e)
	}
	if len(r.calls) != n {
		t.Fatal("resume repeated world reset")
	}
	if e := a.Freeze(context.Background(), "episode-test", Options{}); e != nil {
		t.Fatal(e)
	}
	n = len(r.calls)
	if e := a.Freeze(context.Background(), "episode-test", Options{}); e != nil {
		t.Fatal(e)
	}
	if len(r.calls) != n {
		t.Fatal("freeze not idempotent")
	}
	s, _ := state(d)
	if s.Stage != "scenario_frozen" || len(s.FrozenHash) != 64 {
		t.Fatalf("bad state %+v", s)
	}
	if a.Generate(context.Background(), "episode-test", bundle(t, d), Options{}) == nil {
		t.Fatal("overwrote scenario")
	}
}
func TestScenarioFailureDoesNotValidate(t *testing.T) {
	a, r, d := setup(t)
	hash := generate(t, a, d)
	r.fail = "install.mjs"
	if a.ValidateScenario(context.Background(), "episode-test", Options{Yes: true, Approval: hash}) == nil {
		t.Fatal("ignored install failure")
	}
	s, _ := state(d)
	if s.Stage != "scenario_generated" || s.Error == "" {
		t.Fatalf("bad failure state %+v", s)
	}
	if a.Freeze(context.Background(), "episode-test", Options{}) == nil {
		t.Fatal("froze failed installation")
	}
}
func frozenFixture(t *testing.T) (*App, *fixtureRunner, string) {
	a, r, d := setup(t)
	hash := generate(t, a, d)
	if e := a.ValidateScenario(context.Background(), "episode-test", Options{Yes: true, Approval: hash}); e != nil {
		t.Fatal(e)
	}
	if e := a.Freeze(context.Background(), "episode-test", Options{}); e != nil {
		t.Fatal(e)
	}
	return a, r, d
}
func TestRunTakesIsolationFailureAndEvaluation(t *testing.T) {
	a, r, d := frozenFixture(t)
	goal, _ := os.ReadFile(filepath.Join(d, "goal.md"))
	h := &fixtureHarness{t: t, goal: string(goal)}
	a.Harness = h
	for _, take := range []string{"001", "002"} {
		if e := a.RunAgent(context.Background(), "episode-test", Options{Agent: "claude", Take: take, Yes: true}); e != nil {
			t.Fatal(e)
		}
		var run Run
		if e := storage.ReadJSON(filepath.Join(d, "runs/claude/take-"+take+"/run.json"), &run); e != nil {
			t.Fatal(e)
		}
		if run.Infrastructure != "completed" || run.Objective.Outcome != "success" {
			t.Fatalf("%+v", run)
		}
	}
	n := len(r.calls)
	if a.RunAgent(context.Background(), "episode-test", Options{Agent: "claude", Yes: true}) == nil {
		t.Fatal("overwrote take")
	}
	if len(r.calls) != n {
		t.Fatal("restored before overwrite check")
	}
	if a.RunAgent(context.Background(), "episode-test", Options{Agent: "codex", Yes: true}) == nil {
		t.Fatal("unisolated codex allowed")
	}
	if len(r.calls) != n {
		t.Fatal("mutated world before isolation check")
	}
	h.fail = errors.New("harness auth failure")
	if a.RunAgent(context.Background(), "episode-test", Options{Agent: "claude", Take: "003", Yes: true}) == nil {
		t.Fatal("ignored harness failure")
	}
	var run Run
	storage.ReadJSON(filepath.Join(d, "runs/claude/take-003/run.json"), &run)
	if run.Infrastructure != "failed" || run.Error == "" || run.Objective.Outcome != "success" {
		t.Fatalf("infrastructure/objective conflated: %+v", run)
	}
}
func TestFreezeTamperingAndDryRun(t *testing.T) {
	a, r, d := frozenFixture(t)
	n := len(r.calls)
	if e := a.RunAgent(context.Background(), "episode-test", Options{Agent: "claude", DryRun: true}); e != nil {
		t.Fatal(e)
	}
	if len(r.calls) != n {
		t.Fatal("dry run executed subprocess")
	}
	os.WriteFile(filepath.Join(d, "level-design.md"), []byte("modified world design"), 0600)
	if a.RunAgent(context.Background(), "episode-test", Options{Agent: "claude", Yes: true}) == nil {
		t.Fatal("changed world design accepted")
	}
	if len(r.calls) != n {
		t.Fatal("tampering modified world")
	}
}

func TestSameFrozenWorldAcceptsDifferentGoalsAndPreservesEachTake(t *testing.T) {
	a, runner, d := frozenFixture(t)
	originalGoal, _ := os.ReadFile(filepath.Join(d, "goal.md"))
	before, e := storage.Hash(filepath.Join(d, "frozen"))
	if e != nil {
		t.Fatal(e)
	}
	goals := []string{string(originalGoal), "  Reach the same landmark. You may use the survey once.\r\n"}
	for i, goal := range goals {
		take := fmt.Sprintf("%03d", i+1)
		if e = os.WriteFile(filepath.Join(d, "goal.md"), []byte(goal), 0600); e != nil {
			t.Fatal(e)
		}
		a.Harness = &fixtureHarness{t: t, goal: goal}
		dest := filepath.Join(d, "runs/claude/take-"+take)
		runner.onRestore = func() {
			var run Run
			if e := storage.ReadJSON(filepath.Join(dest, "run.json"), &run); e != nil {
				t.Fatal(e)
			}
			if run.GoalPrompt != goal || run.GoalHash != promptHash(goal) {
				t.Fatal("goal not persisted before world restore")
			}
			// Edits during startup must not alter the already captured prompt.
			os.WriteFile(filepath.Join(d, "goal.md"), []byte("Edited while the take was starting."), 0600)
		}
		if e = a.RunAgent(context.Background(), "episode-test", Options{Agent: "claude", Take: take, Yes: true}); e != nil {
			t.Fatal(e)
		}
		var run Run
		if e = storage.ReadJSON(filepath.Join(dest, "run.json"), &run); e != nil {
			t.Fatal(e)
		}
		b, e := os.ReadFile(filepath.Join(dest, "goal.md"))
		if e != nil || string(b) != goal || run.GoalPrompt != goal || run.GoalHash != promptHash(goal) || run.ScenarioHash != before {
			t.Fatalf("incorrect take goal or scenario identity: %+v %v", run, e)
		}
	}
	first, _ := os.ReadFile(filepath.Join(d, "runs/claude/take-001/goal.md"))
	if string(first) != string(originalGoal) {
		t.Fatal("later goal replaced original take goal")
	}
	after, e := storage.Hash(filepath.Join(d, "frozen"))
	if e != nil || before != after {
		t.Fatal("goal change modified the frozen snapshot")
	}
}

func TestChangedGoalSourceIsAllowedButChangedEvaluationIsNot(t *testing.T) {
	a, runner, d := frozenFixture(t)
	yamlPath := filepath.Join(d, "episode.yaml")
	original, _ := os.ReadFile(yamlPath)
	updated := strings.Replace(string(original), "prompt_file: goal.md", "prompt_file: alternate-goal.md", 1)
	os.WriteFile(yamlPath, []byte(updated), 0600)
	os.WriteFile(filepath.Join(d, "alternate-goal.md"), []byte("Reach the landmark using your own strategy."), 0600)
	n := len(runner.calls)
	if e := a.RunAgent(context.Background(), "episode-test", Options{Agent: "claude", DryRun: true}); e != nil {
		t.Fatal(e)
	}
	os.WriteFile(yamlPath, []byte(strings.Replace(updated, "radius: 4", "radius: 5", 1)), 0600)
	if e := a.RunAgent(context.Background(), "episode-test", Options{Agent: "claude", Yes: true}); e == nil {
		t.Fatal("changed evaluation accepted")
	}
	if len(runner.calls) != n {
		t.Fatal("rejected configuration modified the world")
	}
}

func TestGoalChangedAfterConfirmationCannotRestoreWorld(t *testing.T) {
	a, runner, d := frozenFixture(t)
	n := len(runner.calls)
	os.WriteFile(filepath.Join(d, "goal.md"), []byte("A different goal than the one approved."), 0600)
	e := a.RunAgent(context.Background(), "episode-test", Options{Agent: "claude", Yes: true, ExpectedGoalHash: promptHash("Approved goal")})
	if e == nil || !strings.Contains(e.Error(), "goal changed after confirmation") {
		t.Fatal(e)
	}
	if len(runner.calls) != n {
		t.Fatal("changed goal triggered world restoration")
	}
	if _, e = os.Stat(filepath.Join(d, "runs/claude/take-001")); !os.IsNotExist(e) {
		t.Fatal("changed goal allocated a take")
	}
}
func TestTakeNaming(t *testing.T) {
	for _, take := range []string{"000", "1", "../x", "abc", "1000", "-01"} {
		if _, e := takeName(take); e == nil {
			t.Fatal(take)
		}
	}
	if got, e := takeName(""); e != nil || got != "take-001" {
		t.Fatal(got, e)
	}
}
func TestEvaluation(t *testing.T) {
	for _, tt := range []struct {
		name, infra, want string
		events            any
	}{
		{"agent claim", "completed", "unknown", []any{map[string]any{"action": "finish_session", "details": map[string]any{"success": true}}}},
		{"reached", "failed", "success", observations(Point{40, 80, 0})},
		{"outside", "completed", "failure", observations(Point{0, 80, 0})},
		{"timeout", "timed_out", "incomplete", observations(Point{0, 80, 0})},
	} {
		t.Run(tt.name, func(t *testing.T) {
			p := filepath.Join(t.TempDir(), "events.json")
			storage.JSON(p, tt.events)
			if e := Evaluate(p, Point{40, 80, 0}, 4, tt.infra); e.Outcome != tt.want {
				t.Fatalf("%+v", e)
			}
		})
	}
}
func observations(p Point) any {
	return []any{map[string]any{"action": "objective_observation", "details": map[string]any{"result": map[string]any{"position": p}}}}
}

func TestTimedOutTakePreservesArtifactsAndSeparateOutcome(t *testing.T) {
	a, _, d := frozenFixture(t)
	goal, _ := os.ReadFile(filepath.Join(d, "goal.md"))
	a.Harness = &fixtureHarness{t: t, goal: string(goal), fail: context.DeadlineExceeded}
	if e := a.RunAgent(context.Background(), "episode-test", Options{Agent: "claude", Yes: true}); !errors.Is(e, context.DeadlineExceeded) {
		t.Fatal(e)
	}
	var r Run
	storage.ReadJSON(filepath.Join(d, "runs/claude/take-001/run.json"), &r)
	if r.Infrastructure != "timed_out" || r.Objective.Outcome != "success" {
		t.Fatalf("%+v", r)
	}
	if _, e := os.Stat(filepath.Join(d, "runs/claude/take-001/events.json")); e != nil {
		t.Fatal(e)
	}
}
func TestEditedApprovedCodeRequiresNewApproval(t *testing.T) {
	a, r, d := setup(t)
	hash := generate(t, a, d)
	storage.Write(filepath.Join(d, "scenario/implementation/install.mjs"), []byte("// edited\n"))
	if a.ValidateScenario(context.Background(), "episode-test", Options{Yes: true, Approval: hash}) == nil {
		t.Fatal("stale approval accepted")
	}
	if len(r.calls) != 0 {
		t.Fatal("executed code with stale digest")
	}
}
func TestFrozenWorldMutationIsRejected(t *testing.T) {
	a, r, d := frozenFixture(t)
	p := filepath.Join(d, "frozen/world/world/level.dat")
	os.Chmod(p, 0600)
	os.WriteFile(p, []byte("tampered"), 0600)
	n := len(r.calls)
	if a.RunAgent(context.Background(), "episode-test", Options{Agent: "claude", Yes: true}) == nil {
		t.Fatal("mutated snapshot accepted")
	}
	if len(r.calls) != n {
		t.Fatal("restored tampered world")
	}
}
func TestFreezeRepairsStateWithoutRepeatingSnapshot(t *testing.T) {
	a, r, d := frozenFixture(t)
	s, _ := state(d)
	s.Stage = "scenario_validated"
	s.FrozenHash = ""
	saveState(d, s)
	n := len(r.calls)
	if e := a.Freeze(context.Background(), "episode-test", Options{}); e != nil {
		t.Fatal(e)
	}
	if len(r.calls) != n {
		t.Fatal("snapshot repeated")
	}
	s, _ = state(d)
	if s.Stage != "scenario_frozen" || s.FrozenHash == "" {
		t.Fatalf("%+v", s)
	}
}

func TestEvaluationIgnoresUnrelatedErrorPayloads(t *testing.T) {
	p := filepath.Join(t.TempDir(), "events.json")
	storage.JSON(p, []any{map[string]any{"action": "recorder_error", "details": "encoder failed"}, map[string]any{"action": "objective_observation", "details": map[string]any{"result": map[string]any{"position": Point{40, 80, 0}}}}})
	if got := Evaluate(p, Point{40, 80, 0}, 4, "aborted"); got.Outcome != "success" {
		t.Fatal(got)
	}
}

func TestHarnessFailureReportsStdoutAuthenticationErrorAndActualLogPaths(t *testing.T) {
	d := t.TempDir()
	storage.Write(filepath.Join(d, "harness.stdout.log"), []byte("Not logged in · Please run /login\n"))
	storage.Write(filepath.Join(d, "harness.stderr.log"), nil)
	cause := errors.New("claude exited 1")
	err := harnessFailure(d, cause)
	if !errors.Is(err, cause) || !strings.Contains(err.Error(), "Not logged in") || !strings.Contains(err.Error(), filepath.Join(d, "harness.stdout.log")) {
		t.Fatal(err)
	}
}
