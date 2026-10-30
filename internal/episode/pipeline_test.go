package episode

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
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

func TestGuidedConfirmationNeverDefaultsToYes(t *testing.T) {
	for _, input := range []string{"\n", "n\n", "q\n", ""} {
		t.Run(input, func(t *testing.T) {
			w := wizard{New(t.TempDir(), io.Discard), bufioReader(input)}
			if w.confirm(context.Background(), "Install?") == nil {
				t.Fatal("implicit approval")
			}
		})
	}
	w := wizard{New(t.TempDir(), io.Discard), bufioReader("maybe\ny\n")}
	if e := w.confirm(context.Background(), "Install?"); e != nil {
		t.Fatal(e)
	}
}
func bufioReader(s string) *bufio.Reader { return bufio.NewReader(strings.NewReader(s)) }
func TestPipelineImportsArbitraryYAMLAndPreservesPrompts(t *testing.T) {
	a, _, _ := setup(t)
	source := t.TempDir()
	text := strings.Replace(Starter("episode-external"), "prompt_file: goal.md", "prompt_file: public-goal.md", 1)
	os.WriteFile(filepath.Join(source, "experiment.yml"), []byte(text), 0600)
	os.WriteFile(filepath.Join(source, "level-design.md"), []byte("  build\nexact\n"), 0600)
	os.WriteFile(filepath.Join(source, "public-goal.md"), []byte(" public\r\ngoal\n"), 0600)
	d, c, e := a.pipelineConfig(filepath.Join(source, "experiment.yml"), PipelineOptions{Designer: "codex", Player: "claude"})
	if e != nil {
		t.Fatal(e)
	}
	goal, _ := c.Goal.Text(d)
	if goal != " public\r\ngoal\n" || c.LevelDesign.Harness != "codex" {
		t.Fatal(goal, c.LevelDesign.Harness)
	}
	if _, _, e = a.pipelineConfig(filepath.Join(source, "experiment.yml"), PipelineOptions{Designer: "codex", Player: "claude"}); e != nil {
		t.Fatal("could not resume", e)
	}
	os.WriteFile(filepath.Join(source, "public-goal.md"), []byte("changed"), 0600)
	if _, _, e = a.pipelineConfig(filepath.Join(source, "experiment.yml"), PipelineOptions{Designer: "codex", Player: "claude"}); e == nil {
		t.Fatal("overwrote imported prompts")
	}
}

type reviewer struct {
	decision string
	calls    int
}

func (r *reviewer) Run(_ context.Context, q harness.Request) (executor.Result, error) {
	r.calls++
	if q.Player {
		return executor.Result{}, fmt.Errorf("unexpected player run")
	}
	response := map[string]any{"decision": r.decision, "summary": "Fixture code review", "checks": []string{"Bounded local operations checked"}}
	b, _ := json.Marshal(response)
	if q.Harness == "codex" {
		os.WriteFile(q.Output, b, 0600)
	} else {
		q.Stdout.Write(b)
	}
	return executor.Result{}, nil
}
func TestPipelineExplainsAndStopsBeforeUnapprovedReset(t *testing.T) {
	for _, decision := range []string{"approve", "reject"} {
		a, r, d := setup(t)
		generate(t, a, d)
		review := &reviewer{decision: decision}
		a.Harness = review
		var output bytes.Buffer
		a.Out = &output
		e := a.Pipeline(context.Background(), filepath.Join(d, "episode.yaml"), PipelineOptions{Designer: "claude", Player: "claude", Input: strings.NewReader("n\n")})
		if e == nil {
			t.Fatal("continued without approval")
		}
		if len(r.calls) != 0 {
			t.Fatal("ran world commands before approval")
		}
		if review.calls != 1 {
			t.Fatal("missing separate code review")
		}
		if !strings.Contains(output.String(), "STEP 2") {
			t.Fatal(output.String())
		}
	}
}
func TestPipelineResumeAudioDoesNotResetOrRepeatAgent(t *testing.T) {
	a, r, d := frozenFixture(t)
	goal, _ := os.ReadFile(filepath.Join(d, "goal.md"))
	h := &fixtureHarness{t: t, goal: string(goal)}
	a.Harness = h
	if e := a.RunAgent(context.Background(), "episode-test", Options{Agent: "claude", Yes: true}); e != nil {
		t.Fatal(e)
	}
	var run Run
	runFile := filepath.Join(d, "runs/claude/take-001/run.json")
	storage.ReadJSON(runFile, &run)
	pid := "episode-test-claude-001"
	run.Workflow = "extracted"
	run.ProductionID = pid
	storage.JSON(runFile, run)
	out := filepath.Join(a.Root, "production", pid)
	storage.JSON(filepath.Join(out, "narration-manifest.json"), []any{map[string]any{"line": 1, "audio": "1_Chapter_1.wav"}})
	storage.JSON(filepath.Join(d, ".pipeline/current-run.json"), map[string]string{"agent": "claude", "take": "001"})
	os.WriteFile(filepath.Join(d, "goal.md"), []byte("A revised goal for a future take."), 0600)
	n := len(r.calls)
	guard := &expiredHarness{Harness: h}
	a.Harness = guard
	e := a.Pipeline(context.Background(), filepath.Join(d, "episode.yaml"), PipelineOptions{Designer: "claude", Player: "claude", Input: strings.NewReader("q\n")})
	if e == nil || !strings.Contains(e.Error(), "paused for audio") {
		t.Fatal(e)
	}
	if len(r.calls) != n || h.calls != 1 || guard.checks != 0 {
		t.Fatal("resuming audio reran world or model")
	}
	var preserved Run
	storage.ReadJSON(runFile, &preserved)
	if preserved.GoalPrompt != string(goal) || preserved.GoalHash != promptHash(string(goal)) {
		t.Fatal("resuming production replaced the recorded goal")
	}
}

func TestPipelineReviewsRevisedGoalForNewTakeOnApprovedFrozenWorld(t *testing.T) {
	a, runner, d := frozenFixture(t)
	s, e := state(d)
	if e != nil {
		t.Fatal(e)
	}
	storage.JSON(filepath.Join(d, ".pipeline/scenario-approval.json"), map[string]string{"hash": s.FrozenHash})
	goal := "Reach the same landmark. Choose when to spend your one survey."
	os.WriteFile(filepath.Join(d, "goal.md"), []byte(goal), 0600)
	a.Harness = &fixtureHarness{t: t, goal: goal}
	var out bytes.Buffer
	a.Out = &out
	n := len(runner.calls)
	e = a.Pipeline(context.Background(), filepath.Join(d, "episode.yaml"), PipelineOptions{Designer: "claude", Player: "claude", Take: "002", Input: strings.NewReader("n\n")})
	if e == nil || !strings.Contains(e.Error(), "stopped at your request") {
		t.Fatal(e)
	}
	if !strings.Contains(out.String(), goal) || !strings.Contains(out.String(), promptHash(goal)) {
		t.Fatal("new take did not show current goal and identity")
	}
	if len(runner.calls) != n || strings.Contains(out.String(), "STEP 1") {
		t.Fatal("goal edit regenerated or restored the world before approval")
	}
}
func TestPipelineDryRunDoesNotImportOrExecute(t *testing.T) {
	a, r, d := setup(t)
	if e := a.Pipeline(context.Background(), filepath.Join(d, "episode.yaml"), PipelineOptions{Designer: "codex", Player: "claude", DryRun: true}); e != nil {
		t.Fatal(e)
	}
	if len(r.calls) != 0 {
		t.Fatal("dry run executed subprocess")
	}
	if _, e := os.Stat(filepath.Join(d, ".pipeline")); !os.IsNotExist(e) {
		t.Fatal("dry run wrote state")
	}
	if e := a.Pipeline(context.Background(), filepath.Join(d, "episode.yaml"), PipelineOptions{Player: "codex", DryRun: true}); e == nil {
		t.Fatal("unsafe Codex player allowed")
	}
}
func TestPipelineTakeSelectionIsPinnedAcrossResume(t *testing.T) {
	a, _, d := setup(t)
	p, _ := a.runPath(d, Options{Agent: "claude", Take: "001"})
	os.MkdirAll(p, 0755)
	o, e := a.pipelineTake(d, "claude", "")
	if e != nil || o.Take != "002" {
		t.Fatal(o, e)
	}
	os.MkdirAll(filepath.Join(d, "runs/claude/take-002"), 0755)
	again, e := a.pipelineTake(d, "claude", "")
	if e != nil || again.Take != "002" {
		t.Fatal(again, e)
	}
	next, e := a.pipelineTake(d, "claude", "003")
	if e != nil || next.Take != "003" {
		t.Fatal(next, e)
	}
}

type expiredHarness struct {
	harness.Harness
	checks int
}

func (h *expiredHarness) Check(context.Context, harness.Request) error {
	h.checks++
	return fmt.Errorf("authentication expired")
}
