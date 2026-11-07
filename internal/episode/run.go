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
	"sync"
	"time"

	"github.com/tonitienda/agent-world-lab/characters"
	"github.com/tonitienda/agent-world-lab/internal/config"
	"github.com/tonitienda/agent-world-lab/internal/harness"
	"github.com/tonitienda/agent-world-lab/internal/storage"
)

// seat is one player's place in a take: who plays, what they are told, where
// they start and where their cameras and logs go. A solo take has one seat with
// the historical player name and control files; a team take has one per member.
type seat struct {
	agent    config.Agent
	username string
	goal     string
	spawn    Point
	dest     string
	control  string
	viewer   int
	// cast is the take's EMERGENCE_CAST JSON (every seat's character, keyed by
	// username), empty when nobody plays a roster character.
	cast string
}
type seatResult struct {
	exitCode       int
	infrastructure string
	reported       string
	err            error
}

// MemberRun is one team member's share of a team take.
type MemberRun struct {
	Agent          string     `json:"agent"`
	Harness        string     `json:"harness"`
	Model          string     `json:"model"`
	Infrastructure string     `json:"infrastructure"`
	Objective      Evaluation `json:"objective"`
	ExitCode       int        `json:"exit_code"`
	Artifacts      string     `json:"artifacts"`
	Error          string     `json:"error,omitempty"`
}

func (a *App) RunAgent(ctx context.Context, id string, o Options) (err error) {
	d, c, e := a.load(id)
	if e != nil {
		return e
	}
	team := c.Together()
	var players []config.Agent
	if team {
		// The yaml's agents are the team; there is nothing to choose.
		if o.Agent != "" && o.Agent != config.TogetherTake {
			return fmt.Errorf("%s plays all its agents together; omit --agent", id)
		}
		o.Agent = config.TogetherTake
		players = c.Agents
	} else if agent := agentByID(c, o.Agent); agent.ID != "" {
		players = []config.Agent{agent}
	}
	if len(players) == 0 {
		return fmt.Errorf("choose a configured --agent")
	}
	// Check isolation and harness availability before any reset, restoration or take allocation.
	for _, p := range players {
		if _, e = harness.Command(harness.Request{Harness: p.Harness, Player: true}); e != nil {
			return e
		}
	}

	snapshot, f, e := a.frozen(d, c)
	if e != nil {
		return e
	}
	goals := make([]string, len(players))
	for i, p := range players {
		if goals[i], e = c.AgentGoal(d, p); e != nil {
			return e
		}
	}
	goal := goals[0]
	if team {
		parts := make([]string, len(players))
		for i, p := range players {
			parts[i] = "## " + p.ID + "\n\n" + goals[i]
		}
		goal = strings.Join(parts, "\n\n")
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
	names := make([]string, len(players))
	for i, p := range players {
		names[i] = p.Harness
	}
	if o.DryRun {
		fmt.Fprintf(a.Out, "Would restore %s and record %s with MCP-only %s and current player goal SHA-256 %s; no changes.\n", f.Hash, dest, strings.Join(names, " + "), goalHash)
		return nil
	}
	if !o.Yes {
		return fmt.Errorf("restoring a take replaces the active world (archived first); pass --yes or inspect --dry-run")
	}
	if checker, ok := a.Harness.(interface {
		Check(context.Context, harness.Request) error
	}); ok && !o.DryRun {
		checked := map[string]bool{}
		for _, p := range players {
			if checked[p.Harness] {
				continue
			}
			checked[p.Harness] = true
			if e := checker.Check(ctx, harness.Request{Harness: p.Harness, Player: true, Dir: a.Root, Env: a.env()}); e != nil {
				return e
			}
		}
	}
	if e = os.MkdirAll(filepath.Dir(dest), 0755); e != nil {
		return e
	}
	if e = os.Mkdir(dest, 0700); e != nil {
		return e
	}
	now := time.Now().UTC()
	r := Run{Version: 1, Agent: players[0].ID, Harness: players[0].Harness, Model: players[0].Model, Take: filepath.Base(dest), Workflow: "running", Infrastructure: "running", Objective: Evaluation{Outcome: "unknown", Evidence: "run not yet evaluated"}, AgentReportedOutcome: "not reported", GoalPrompt: goal, GoalHash: goalHash, ScenarioHash: f.Hash, StartedAt: now, Artifacts: dest, ExitCode: -1}
	if team {
		r.Agent, r.Harness, r.Model = config.TogetherTake, "team", ""
	}
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
	var m Manifest
	if e = storage.ReadJSON(filepath.Join(snapshot, "manifest.json"), &m); e != nil {
		return e
	}
	seats := make([]seat, len(players))
	for i, p := range players {
		seats[i] = seat{agent: p, username: "emergence-player", goal: goals[i], spawn: m.Spawn, dest: dest, viewer: 3007}
		if team {
			spawn, ok := m.Spawns[p.ID]
			if !ok {
				return fmt.Errorf("frozen manifest has no spawn for team member %s", p.ID)
			}
			// Ten ports per seat keeps each recorder's three viewers apart.
			seats[i] = seat{agent: p, username: p.ID, goal: goals[i], spawn: spawn, dest: filepath.Join(dest, p.ID), control: p.ID, viewer: 3007 + 10*i}
			if e = os.Mkdir(seats[i].dest, 0700); e != nil {
				return e
			}
			if e = storage.Write(filepath.Join(seats[i].dest, "goal.md"), []byte(goals[i])); e != nil {
				return e
			}
		}
	}
	cast, e := a.cast(seats)
	if e != nil {
		return e
	}
	for i := range seats {
		seats[i].cast = cast
	}
	// Every seat shares one world and one deadline; they play concurrently.
	results := make([]seatResult, len(seats))
	var wg sync.WaitGroup
	for i := range seats {
		wg.Add(1)
		done := make(chan struct{})
		go func(i int) {
			defer wg.Done()
			defer close(done)
			results[i] = a.play(ctx, c, f.MinecraftVersion, seats[i])
		}(i)
		if team && i < len(seats)-1 {
			// Opening three cameras meshes a whole view distance per view; six at
			// once starved the CPU (episode-006 takes 001-002). Start the next
			// seat once this one's cameras are up. Its player gains a short head start.
			_, ready := a.controlFiles(seats[i].control)
			a.awaitSeat(ctx, ready, done, 4*time.Minute)
		}
	}
	wg.Wait()

	target := m.Targets[c.Evaluation.Target]
	var runErr error
	if !team {
		res := results[0]
		r.ExitCode, r.Infrastructure, r.AgentReportedOutcome, runErr = res.exitCode, res.infrastructure, res.reported, res.err
		r.Objective = Evaluate(filepath.Join(dest, "events.json"), target, c.Evaluation.Radius, r.Infrastructure)
	} else {
		r.ExitCode = 0
		infra := make([]string, len(seats))
		for i, s := range seats {
			res := results[i]
			mr := MemberRun{Agent: s.agent.ID, Harness: s.agent.Harness, Model: s.agent.Model, Infrastructure: res.infrastructure, ExitCode: res.exitCode, Artifacts: s.dest}
			mr.Objective = Evaluate(filepath.Join(s.dest, "events.json"), target, c.Evaluation.Radius, res.infrastructure)
			if res.err != nil {
				mr.Error = res.err.Error()
				if runErr == nil {
					runErr = fmt.Errorf("%s: %w", s.agent.ID, res.err)
				}
			}
			if res.exitCode != 0 && r.ExitCode == 0 {
				r.ExitCode = res.exitCode
			}
			infra[i] = res.infrastructure
			r.Members = append(r.Members, mr)
		}
		r.Infrastructure = worstInfrastructure(infra)
		r.Objective = teamObjective(r.Members)
		r.AgentReportedOutcome = "per member: see <member>/harness.stdout.log"
	}
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
		if team {
			return runErr
		}
		return harnessFailure(dest, runErr)
	}
	if r.Infrastructure != "completed" {
		return fmt.Errorf("session %s; preserved artifacts at %s", r.Infrastructure, dest)
	}
	fmt.Fprintf(a.Out, "Recorded %s; objective=%s. Artifacts: %s\n", r.Agent, r.Objective.Outcome, dest)
	return nil
}

// cast dresses every seat that plays a roster character. Each recorder gets the
// whole cast so it can skin and label the other players it sees, not just its own.
func (a *App) cast(seats []seat) (string, error) {
	cast := characters.Cast{}
	for _, s := range seats {
		if s.agent.Character == "" {
			continue
		}
		ch, e := characters.Lookup(s.agent.Character)
		if e != nil {
			return "", e
		}
		cast[s.username] = ch.Member(a.Root)
	}
	if len(cast) == 0 {
		return "", nil
	}
	return cast.JSON()
}

func agentByID(c config.Config, id string) config.Agent {
	for _, candidate := range c.Agents {
		if candidate.ID == id {
			return candidate
		}
	}
	return config.Agent{}
}

// awaitSeat returns once a seat's MCP server is ready, the seat has ended, the
// take is cancelled, or limit passes. It never fails the take: a slow seat only
// means the next one starts under more load.
func (a *App) awaitSeat(ctx context.Context, ready string, done <-chan struct{}, limit time.Duration) {
	deadline := time.After(limit)
	tick := time.NewTicker(250 * time.Millisecond)
	defer tick.Stop()
	for {
		if _, e := os.Stat(ready); e == nil {
			return
		}
		select {
		case <-done:
			return
		case <-ctx.Done():
			return
		case <-deadline:
			return
		case <-tick.C:
		}
	}
}

// controlFiles names a seat's operator stop request and MCP readiness marker.
// The unnamed pair is the historical single-session protocol.
func (a *App) controlFiles(id string) (request, ready string) {
	lock := filepath.Join(a.Root, "data/active-session.lock")
	if id == "" {
		return filepath.Join(lock, "control.json"), filepath.Join(lock, "mcp-control-ready")
	}
	return filepath.Join(lock, "control-"+id+".json"), filepath.Join(lock, "mcp-control-ready-"+id)
}

// play runs one seat's harness against its own MCP server and recorder, then
// waits for that MCP process to finalize its cameras and events.
func (a *App) play(ctx context.Context, c config.Config, version string, s seat) seatResult {
	res := seatResult{exitCode: -1, infrastructure: "failed"}
	work, e := os.MkdirTemp("", "emergence-player-*")
	if e != nil {
		res.err = e
		return res
	}
	defer os.RemoveAll(work)
	spawn, _ := json.Marshal(s.spawn)
	// Explicit MCP env is an allowlist. SCENARIO_FILE is intentionally absent.
	mcpEnv := map[string]string{"WORLD_ADAPTER": "minecraft", "AGENT_ID": s.username, "RECORD_MP4": filepath.Join(s.dest, "agent-pov.mp4"), "MC_HOST": "127.0.0.1", "MC_PORT": fmt.Sprint(c.Environment.Minecraft.Port), "MC_VERSION": version, "EMERGENCE_EXPECTED_START": string(spawn), "EMERGENCE_LEASE": a.lease, "EMERGENCE_OWNER_PID": fmt.Sprint(os.Getpid())}
	if s.control != "" {
		mcpEnv["EMERGENCE_CONTROL_ID"] = s.control
		mcpEnv["RECORD_VIEWER_PORT"] = fmt.Sprint(s.viewer)
	}
	if s.cast != "" {
		mcpEnv["EMERGENCE_CAST"] = s.cast
	}
	// Provider-independent capture defaults for every recorded take.
	mcpEnv["RECORD_WIDTH"], mcpEnv["RECORD_HEIGHT"], mcpEnv["RECORD_FPS"] = "3840", "2160", "60"
	if s.control != "" {
		// Every seat software-renders three views (SwiftShader) and encodes them.
		// On a 10-core Mac one seat used ~7.5 cores even at 1080p30, so a second
		// seat's cameras never readied (episode-006 takes 001-003). 720p30 is the
		// budget at which two seats can share the CPU.
		mcpEnv["RECORD_WIDTH"], mcpEnv["RECORD_HEIGHT"], mcpEnv["RECORD_FPS"] = "1280", "720", "30"
	}
	// Absolute npm prefix keeps the trusted MCP implementation in the repository,
	// while the model's working directory contains no privileged episode artifacts.
	mcpc := map[string]any{"mcpServers": map[string]any{"agent-world": map[string]any{"command": "npm", "args": []string{"--silent", "--prefix", a.Root, "run", "mcp"}, "env": mcpEnv}}}
	mcpath := filepath.Join(work, "mcp.json")
	if res.err = storage.JSON(mcpath, mcpc); res.err != nil {
		return res
	}
	stdout, e := os.OpenFile(filepath.Join(s.dest, "harness.stdout.log"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		res.err = e
		return res
	}
	defer stdout.Close()
	stderr, e := os.OpenFile(filepath.Join(s.dest, "harness.stderr.log"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		res.err = e
		return res
	}
	defer stderr.Close()
	runctx, stop := context.WithTimeout(ctx, time.Duration(c.Recording.MaxDurationMinutes)*time.Minute)
	defer stop()
	request, ready := a.controlFiles(s.control)
	requestStop := func() {
		if _, e := os.Stat(ready); e == nil {
			_ = storage.JSON(request, map[string]string{"outcome": "stopped"})
		}
	}
	result, runErr := a.Harness.Run(runctx, harness.Request{Harness: s.agent.Harness, Model: s.agent.Model, Player: true, Dir: work, Prompt: s.goal, MCPConfig: mcpath, Env: a.env("MCP_TIMEOUT=180000", "CLAUDE_CODE_MCP_STARTUP_WAIT_MS=180000"), Stdout: stdout, Stderr: stderr, OnCancel: requestStop})
	res.exitCode = result.ExitCode
	// A harness exit is not recording finalization. Request the existing lifecycle
	// controller and wait independently of the expired run context before releasing.
	if _, e = os.Stat(filepath.Join(s.dest, "mcp-session.json")); os.IsNotExist(e) {
		requestStop()
		deadline := time.Now().Add(90 * time.Second)
		for time.Now().Before(deadline) {
			if _, e = os.Stat(filepath.Join(s.dest, "mcp-session.json")); e == nil {
				break
			}
			if _, e = os.Stat(ready); os.IsNotExist(e) {
				break
			}
			time.Sleep(200 * time.Millisecond)
		}
	}
	var session struct {
		Outcome string `json:"outcome"`
		Reason  string `json:"reason"`
	}
	sessionErr := storage.ReadJSON(filepath.Join(s.dest, "mcp-session.json"), &session)
	res.infrastructure = "completed"
	if sessionErr != nil || (session.Outcome != "completed" && session.Outcome != "stopped") {
		res.infrastructure = "aborted"
	} else if session.Outcome == "stopped" {
		res.infrastructure = "stopped"
	}
	if runErr != nil {
		res.infrastructure = "failed"
	}
	if errors.Is(runErr, context.DeadlineExceeded) || errors.Is(runctx.Err(), context.DeadlineExceeded) {
		res.infrastructure = "timed_out"
	} else if errors.Is(ctx.Err(), context.Canceled) {
		res.infrastructure = "stopped"
	}
	res.reported = "not reported"
	if session.Reason == "agent_finished" {
		res.reported = "finished (objective claim, if any, remains in harness.stdout.log)"
	}
	if b, err := os.ReadFile(filepath.Join(s.dest, "harness.stdout.log")); err == nil && len(b) > 0 {
		res.reported = strings.TrimSpace(string(b))
		if len(res.reported) > 65536 {
			res.reported = "See harness.stdout.log (final response exceeds 64 KiB)"
		}
	}
	if res.infrastructure == "completed" {
		for _, name := range []string{"events.json", "metadata.json", "agent-pov.mp4", "observer.mp4", "follow.mp4"} {
			st, e := os.Stat(filepath.Join(s.dest, name))
			if e != nil || st.Size() == 0 {
				res.infrastructure = "failed"
				runErr = fmt.Errorf("recording incomplete: missing %s", name)
				break
			}
		}
	}
	if runErr != nil && s.control != "" {
		runErr = harnessFailure(s.dest, runErr)
	}
	res.err = runErr
	return res
}

// worstInfrastructure reports a team take by its least healthy seat.
func worstInfrastructure(seats []string) string {
	for _, outcome := range []string{"failed", "aborted", "timed_out", "stopped"} {
		for _, s := range seats {
			if s == outcome {
				return outcome
			}
		}
	}
	return "completed"
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

// teamObjective turns each member's trusted evaluation into the team's outcome.
// Each member's Objective came from Evaluate over that member's own events.json,
// so it is one of "success", "failure", "incomplete" or "unknown".
//
// The objective is a conjunction (everyone must arrive), so a member who
// definitely did not arrive decides it: failure beats incomplete, and both beat
// unknown, because one untrusted log cannot rescue a team that is already
// short a member. Only when nobody definitely missed does an unknown member
// make the team unknown.
func teamObjective(members []MemberRun) Evaluation {
	if len(members) == 0 {
		return Evaluation{"unknown", "team take has no members"}
	}
	rank := map[string]int{"success": 0, "unknown": 1, "incomplete": 2, "failure": 3}
	outcome, evidence := "success", make([]string, 0, len(members))
	for _, m := range members {
		o := m.Objective.Outcome
		if _, ok := rank[o]; !ok {
			o = "unknown"
		}
		if rank[o] > rank[outcome] {
			outcome = o
		}
		evidence = append(evidence, fmt.Sprintf("%s: %s (%s)", m.Agent, o, m.Objective.Evidence))
	}
	return Evaluation{outcome, strings.Join(evidence, "; ")}
}
