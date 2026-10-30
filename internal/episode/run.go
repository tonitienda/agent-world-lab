package episode

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/tonitienda/agent-world-lab/internal/config"
	"github.com/tonitienda/agent-world-lab/internal/harness"
	"github.com/tonitienda/agent-world-lab/internal/storage"
)

func (a *App) RunAgent(ctx context.Context, id string, o Options) (err error) {
	d, c, e := a.load(id)
	if e != nil {
		return e
	}
	var agent config.Agent
	for _, candidate := range c.Agents {
		if candidate.ID == o.Agent {
			agent = candidate
		}
	}
	if agent.ID == "" {
		return fmt.Errorf("choose a configured --agent")
	}
	// Check isolation and harness availability before any reset, restoration or take allocation.
	if _, e = harness.Command(harness.Request{Harness: agent.Harness, Player: true}); e != nil {
		return e
	}

	snapshot, f, e := a.frozen(d, c)
	if e != nil {
		return e
	}
	goal, e := c.Goal.Text(d)
	if e != nil {
		return e
	}
	goalHash := promptHash(goal)
	if o.ExpectedGoalHash != "" && o.ExpectedGoalHash != goalHash {
		return fmt.Errorf("player goal changed after confirmation; rerun to review the new goal before restoring the world")
	}
	dest, e := a.runPath(d, o)
	if e != nil {
		return e
	}
	if _, e = os.Stat(dest); !os.IsNotExist(e) {
		return fmt.Errorf("take exists: %s; choose a new --take (never overwritten or automatically retried)", dest)
	}
	if o.DryRun {
		fmt.Fprintf(a.Out, "Would restore %s and record %s with MCP-only %s and current player goal SHA-256 %s; no changes.\n", f.Hash, dest, agent.Harness, goalHash)
		return nil
	}
	if !o.Yes {
		return fmt.Errorf("restoring a take replaces the active world (archived first); pass --yes or inspect --dry-run")
	}
	if checker, ok := a.Harness.(interface {
		Check(context.Context, harness.Request) error
	}); ok && !o.DryRun {
		if e := checker.Check(ctx, harness.Request{Harness: agent.Harness, Player: true, Dir: a.Root, Env: a.env()}); e != nil {
			return e
		}
	}
	if e = os.MkdirAll(filepath.Dir(dest), 0755); e != nil {
		return e
	}
	if e = os.Mkdir(dest, 0700); e != nil {
		return e
	}
	now := time.Now().UTC()
	r := Run{Version: 1, Agent: agent.ID, Harness: agent.Harness, Model: agent.Model, Take: filepath.Base(dest), Workflow: "running", Infrastructure: "running", Objective: Evaluation{Outcome: "unknown", Evidence: "run not yet evaluated"}, AgentReportedOutcome: "not reported", GoalPrompt: goal, GoalHash: goalHash, ScenarioHash: f.Hash, StartedAt: now, Artifacts: dest, ExitCode: -1}
	if e = storage.Write(filepath.Join(dest, "goal.md"), []byte(goal)); e != nil {
		return e
	}
	if e = storage.JSON(filepath.Join(dest, "run.json"), r); e != nil {
		return e
	}
	defer func() {
		end := time.Now().UTC()
		r.FinishedAt = &end
		r.DurationSeconds = end.Sub(now).Seconds()
		if err != nil {
			r.Error = err.Error()
			if r.Infrastructure == "running" {
				r.Infrastructure = "failed"
			}
			r.Workflow = "run_completed"
		}
		if e := storage.JSON(filepath.Join(dest, "run.json"), r); err == nil {
			err = e
		}
	}()
	release, e := a.reserve(ctx, d)
	if e != nil {
		return e
	}
	defer release()
	prep, cancel := context.WithTimeout(ctx, 15*time.Minute)
	e = a.environment(d, c).Restore(prep, snapshot)
	if e == nil {
		e = a.environment(d, c).Preflight(prep)
	}
	cancel()
	if e != nil {
		return e
	}
	work, e := os.MkdirTemp("", "emergence-player-*")
	if e != nil {
		return e
	}
	defer os.RemoveAll(work)
	var m Manifest
	if e = storage.ReadJSON(filepath.Join(snapshot, "manifest.json"), &m); e != nil {
		return e
	}
	spawn, _ := json.Marshal(m.Spawn)
	// Explicit MCP env is an allowlist. SCENARIO_FILE is intentionally absent.
	mcpEnv := map[string]string{"WORLD_ADAPTER": "minecraft", "AGENT_ID": "emergence-player", "RECORD_MP4": filepath.Join(dest, "agent-pov.mp4"), "MC_HOST": "127.0.0.1", "MC_PORT": fmt.Sprint(c.Environment.Minecraft.Port), "MC_VERSION": f.MinecraftVersion, "EMERGENCE_EXPECTED_START": string(spawn), "EMERGENCE_LEASE": a.lease, "EMERGENCE_OWNER_PID": fmt.Sprint(os.Getpid())}
	// Provider-independent capture defaults for every recorded take.
	mcpEnv["RECORD_WIDTH"], mcpEnv["RECORD_HEIGHT"], mcpEnv["RECORD_FPS"] = "3840", "2160", "60"
	// Absolute npm prefix keeps the trusted MCP implementation in the repository,
	// while the model's working directory contains no privileged episode artifacts.
	mcpc := map[string]any{"mcpServers": map[string]any{"agent-world": map[string]any{"command": "npm", "args": []string{"--silent", "--prefix", a.Root, "run", "mcp"}, "env": mcpEnv}}}
	mcpath := filepath.Join(work, "mcp.json")
	if e = storage.JSON(mcpath, mcpc); e != nil {
		return e
	}
	stdout, e := os.OpenFile(filepath.Join(dest, "harness.stdout.log"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		return e
	}
	defer stdout.Close()
	stderr, e := os.OpenFile(filepath.Join(dest, "harness.stderr.log"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		return e
	}
	defer stderr.Close()
	runctx, stop := context.WithTimeout(ctx, time.Duration(c.Recording.MaxDurationMinutes)*time.Minute)
	defer stop()
	requestStop := func() {
		ready := filepath.Join(a.Root, "data/active-session.lock/mcp-control-ready")
		if _, e := os.Stat(ready); e == nil {
			_ = storage.JSON(filepath.Join(a.Root, "data/active-session.lock/control.json"), map[string]string{"outcome": "stopped"})
		}
	}
	result, runErr := a.Harness.Run(runctx, harness.Request{Harness: agent.Harness, Model: agent.Model, Player: true, Dir: work, Prompt: goal, MCPConfig: mcpath, Env: a.env("MCP_TIMEOUT=180000", "CLAUDE_CODE_MCP_STARTUP_WAIT_MS=180000"), Stdout: stdout, Stderr: stderr, OnCancel: requestStop})
	r.ExitCode = result.ExitCode
	// A harness exit is not recording finalization. Request the existing lifecycle
	// controller and wait independently of the expired run context before releasing.
	if _, e = os.Stat(filepath.Join(dest, "mcp-session.json")); os.IsNotExist(e) {
		requestStop()
		deadline := time.Now().Add(90 * time.Second)
		for time.Now().Before(deadline) {
			if _, e = os.Stat(filepath.Join(dest, "mcp-session.json")); e == nil {
				break
			}
			if _, e = os.Stat(filepath.Join(a.Root, "data/active-session.lock/mcp-control-ready")); os.IsNotExist(e) {
				break
			}
			time.Sleep(200 * time.Millisecond)
		}
	}
	var session struct {
		Outcome string `json:"outcome"`
		Reason  string `json:"reason"`
	}
	sessionErr := storage.ReadJSON(filepath.Join(dest, "mcp-session.json"), &session)
	r.Infrastructure = "completed"
	if sessionErr != nil || (session.Outcome != "completed" && session.Outcome != "stopped") {
		r.Infrastructure = "aborted"
	} else if session.Outcome == "stopped" {
		r.Infrastructure = "stopped"
	}
	if runErr != nil {
		r.Infrastructure = "failed"
	}
	if errors.Is(runErr, context.DeadlineExceeded) || errors.Is(runctx.Err(), context.DeadlineExceeded) {
		r.Infrastructure = "timed_out"
	} else if errors.Is(ctx.Err(), context.Canceled) {
		r.Infrastructure = "stopped"
	}
	if session.Reason == "agent_finished" {
		r.AgentReportedOutcome = "finished (objective claim, if any, remains in harness.stdout.log)"
	}
	if b, err := os.ReadFile(filepath.Join(dest, "harness.stdout.log")); err == nil && len(b) > 0 {
		r.AgentReportedOutcome = strings.TrimSpace(string(b))
		if len(r.AgentReportedOutcome) > 65536 {
			r.AgentReportedOutcome = "See harness.stdout.log (final response exceeds 64 KiB)"
		}
	}

	if r.Infrastructure == "completed" {
		for _, name := range []string{"events.json", "metadata.json", "agent-pov.mp4", "observer.mp4", "follow.mp4"} {
			s, e := os.Stat(filepath.Join(dest, name))
			if e != nil || s.Size() == 0 {
				r.Infrastructure = "failed"
				runErr = fmt.Errorf("recording incomplete: missing %s", name)
				break
			}
		}
	}
	r.Objective = Evaluate(filepath.Join(dest, "events.json"), m.Targets[c.Evaluation.Target], c.Evaluation.Radius, r.Infrastructure)
	r.Workflow = "run_completed"
	s, e := state(d)
	if e != nil {
		return e
	}
	s.Stage = "run_completed"
	s.Error = ""
	if e = saveState(d, s); e != nil {
		return e
	}
	if runErr != nil {
		return harnessFailure(dest, runErr)
	}
	if r.Infrastructure != "completed" {
		return fmt.Errorf("session %s; preserved artifacts at %s", r.Infrastructure, dest)
	}
	fmt.Fprintf(a.Out, "Recorded %s; objective=%s. Artifacts: %s\n", agent.ID, r.Objective.Outcome, dest)
	return nil
}

// Evaluate consumes only trusted adapter observation events, never finish_session
// or model prose. Reaching a target at any recorded observation establishes reach.
func Evaluate(path string, target Point, radius float64, infrastructure string) Evaluation {
	var events []struct {
		Action  string          `json:"action"`
		Details json.RawMessage `json:"details"`
	}

	if e := storage.ReadJSON(path, &events); e != nil {
		return Evaluation{"unknown", "missing/unreadable trusted events"}
	}
	observed := false
	for i, event := range events {
		if event.Action != "observe" && event.Action != "objective_observation" {
			continue
		}
		var observation struct {
			Result struct {
				Position *Point `json:"position"`
			} `json:"result"`
		}
		if json.Unmarshal(event.Details, &observation) != nil {
			continue
		}
		p := observation.Result.Position
		if p == nil || !finite(*p) {
			continue
		}
		observed = true
		distance := math.Sqrt(math.Pow(p.X-target.X, 2) + math.Pow(p.Y-target.Y, 2) + math.Pow(p.Z-target.Z, 2))
		if distance <= radius {
			return Evaluation{"success", fmt.Sprintf("events.json event %d: trusted position (%g,%g,%g), distance %.3f <= %g", i, p.X, p.Y, p.Z, distance, radius)}
		}
	}
	if !observed {
		return Evaluation{"unknown", "no valid trusted position observations"}
	}
	if infrastructure != "completed" {
		return Evaluation{"incomplete", "session ended without an observed target reach"}
	}
	return Evaluation{"failure", "completed session; no trusted observation reached target (continuous traversal is not inferred)"}
}
func (a *App) recorded(id string, o Options) (string, config.Config, string, Run, error) {
	d, c, e := a.load(id)
	if e != nil {
		return d, c, "", Run{}, e
	}
	p, e := a.runPath(d, o)
	if e != nil {
		return d, c, "", Run{}, e
	}
	var r Run
	e = storage.ReadJSON(filepath.Join(p, "run.json"), &r)
	if e == nil && r.Workflow == "running" {
		e = fmt.Errorf("run is not finalized; inspect preserved artifacts before extraction")
	}
	return d, c, p, r, e
}
func productionID(id string, o Options) string {
	t := o.Take
	if t == "" {
		t = "001"
	}
	return strings.Join([]string{id, o.Agent, t}, "-")
}

func promptHash(goal string) string {
	sum := sha256.Sum256([]byte(goal))
	return hex.EncodeToString(sum[:])
}

// Harness authentication errors can be printed to stdout, not stderr. Report
// both exact preserved log paths and bounded output instead of guessing a cause.
func harnessFailure(dir string, cause error) error {
	details := []string{}
	for _, name := range []string{"harness.stderr.log", "harness.stdout.log"} {
		path := filepath.Join(dir, name)
		if b, e := os.ReadFile(path); e == nil && len(b) > 0 {
			if len(b) > 2048 {
				b = b[len(b)-2048:]
			}
			text := strings.TrimSpace(string(b))
			if text != "" {
				details = append(details, name+": "+text)
			}
		}
	}
	message := fmt.Sprintf("Logs: %s and %s", filepath.Join(dir, "harness.stderr.log"), filepath.Join(dir, "harness.stdout.log"))
	if len(details) > 0 {
		message += "\n" + strings.Join(details, "\n")
	}
	return fmt.Errorf("%w\n%s", cause, message)
}
