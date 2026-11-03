package episode

// Game providers (Detonarium, chess): a take plays `rounds` games through the trusted
// MCP server for that game, one isolated harness session per round. Round n uses seed
// + n - 1. There is no designed scenario, world snapshot or reset: a game is fully
// defined by its seed and settings, which the run record keeps.

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/tonitienda/agent-world-lab/internal/config"
	"github.com/tonitienda/agent-world-lab/internal/harness"
	"github.com/tonitienda/agent-world-lab/internal/storage"
)

// GameOutcome is written by the game's MCP server (outcome.json in its session folder)
// from the engine's own result, never from model prose.
type GameOutcome struct {
	Provider string  `json:"provider"`
	Over     bool    `json:"over"`
	AgentWon bool    `json:"agent_won"`
	Draw     bool    `json:"draw"`
	Winner   *string `json:"winner"`
	Detail   string  `json:"detail"`
}

// RoundResult records one round of a game take.
type RoundResult struct {
	Round          int          `json:"round"`
	Seed           int64        `json:"seed"`
	Dir            string       `json:"dir"`
	Infrastructure string       `json:"infrastructure"`
	ExitCode       int          `json:"exit_code"`
	Outcome        *GameOutcome `json:"outcome,omitempty"`
	Error          string       `json:"error,omitempty"`
}

var modelLabel = regexp.MustCompile(`^claude-([a-z]+)-(\d+)-(\d+)$`)

// agentLabel is the player's on-screen name: "Claude Opus 5.5" for claude-opus-5-5.
func agentLabel(model string) string {
	if m := modelLabel.FindStringSubmatch(model); m != nil {
		return "Claude " + strings.ToUpper(m[1][:1]) + m[1][1:] + " " + m[2] + "." + m[3]
	}
	return "Claude"
}

// gameServer returns the npm script and the allowlisted MCP environment for one round.
func gameServer(c config.Config, seed int64, session, label string) (string, map[string]string) {
	env := map[string]string{"SESSION_LOG_DIR": session, "AGENT_ID": "emergence-player", "AGENT_LABEL": label}
	if d := c.Environment.Detonarium; d != nil {
		env["DETONARIUM_SEED"] = strconv.FormatInt(seed, 10)
		env["DETONARIUM_BOTS"] = strings.Join(d.Bots, ",")
		env["DETONARIUM_ALERT_RADIUS"] = strconv.Itoa(d.AlertRadius)
		env["DETONARIUM_MAX_MACRO_TICKS"] = strconv.Itoa(d.MaxMacroTicks)
		return "detonarium:mcp", env
	}
	ch := c.Environment.Chess
	env["CHESS_SIDE"], env["CHESS_ELO"] = ch.Side, ch.Elo
	env["CHESS_MOVETIME_MS"], env["CHESS_MAX_ILLEGAL"] = strconv.Itoa(ch.MovetimeMs), strconv.Itoa(ch.MaxIllegal)
	return "chess:mcp", env
}

// gameGoal fills the placeholders the game prompts use.
func gameGoal(c config.Config, goal string) string {
	if d := c.Environment.Detonarium; d != nil {
		return strings.ReplaceAll(goal, "{{RIVALS}}", strconv.Itoa(len(d.Bots)))
	}
	return strings.ReplaceAll(goal, "{{SIDE}}", c.Environment.Chess.Side)
}

// EvaluateRounds judges a game take from trusted outcomes only.
func EvaluateRounds(c config.Config, rounds []RoundResult) Evaluation {
	wins, finished := 0, 0
	for _, r := range rounds {
		if r.Outcome != nil && r.Outcome.Over {
			finished++
			if r.Outcome.AgentWon {
				wins++
			}
		}
	}
	need := 1
	if c.Evaluation.Type == "win_rounds" {
		need = c.Evaluation.Wins
	}
	evidence := fmt.Sprintf("outcome.json: won %d of %d finished rounds (%d played, %d configured); %d needed", wins, finished, len(rounds), c.Rounds, need)
	switch {
	case wins >= need:
		return Evaluation{"success", evidence}
	case finished == 0:
		return Evaluation{"unknown", "no trusted outcome.json from any round"}
	case finished < c.Rounds && wins+(c.Rounds-finished) >= need:
		return Evaluation{"incomplete", evidence}
	default:
		return Evaluation{"failure", evidence}
	}
}

func (a *App) runGame(ctx context.Context, d string, c config.Config, agent config.Agent, o Options) (err error) {
	goal, e := c.Goal.Text(d)
	if e != nil {
		return e
	}
	goalHash := promptHash(goal)
	if o.ExpectedGoalHash != "" && o.ExpectedGoalHash != goalHash {
		return fmt.Errorf("player goal changed after confirmation; rerun to review the new goal")
	}
	dest, e := a.runPath(d, o)
	if e != nil {
		return e
	}
	if _, e = os.Stat(dest); !os.IsNotExist(e) {
		return fmt.Errorf("take exists: %s; choose a new --take (never overwritten or automatically retried)", dest)
	}
	seed, _ := strconv.ParseInt(c.Environment.Seed, 10, 64)
	if o.DryRun {
		fmt.Fprintf(a.Out, "Would play %d %s round(s) from seed %d into %s with MCP-only %s and player goal SHA-256 %s; no changes.\n", c.Rounds, c.Environment.Provider, seed, dest, agent.Harness, goalHash)
		return nil
	}
	if checker, ok := a.Harness.(interface {
		Check(context.Context, harness.Request) error
	}); ok {
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
	prompt := gameGoal(c, goal)
	r := Run{Version: 1, Agent: agent.ID, Harness: agent.Harness, Model: agent.Model, Take: filepath.Base(dest), Workflow: "running", Infrastructure: "running", Objective: Evaluation{Outcome: "unknown", Evidence: "run not yet evaluated"}, AgentReportedOutcome: "not reported", GoalPrompt: prompt, GoalHash: goalHash, ScenarioHash: "", StartedAt: now, Artifacts: dest, ExitCode: -1}
	if e = storage.Write(filepath.Join(dest, "goal.md"), []byte(prompt)); e != nil {
		return e
	}
	save := func() error { return storage.JSON(filepath.Join(dest, "run.json"), r) }
	if e = save(); e != nil {
		return e
	}
	defer func() {
		end := time.Now().UTC()
		r.FinishedAt = &end
		r.DurationSeconds = end.Sub(now).Seconds()
		r.Objective = EvaluateRounds(c, r.Rounds)
		r.Workflow = "run_completed"
		if err != nil {
			r.Error = err.Error()
			if r.Infrastructure == "running" {
				r.Infrastructure = "failed"
			}
		}
		if e := save(); err == nil {
			err = e
		}
	}()
	label := agentLabel(agent.Model)
	r.Infrastructure = "completed"
	var firstErr error
	for n := 1; n <= c.Rounds; n++ {
		round := RoundResult{Round: n, Seed: seed + int64(n-1), Dir: filepath.Join(dest, fmt.Sprintf("round-%d", n)), Infrastructure: "running", ExitCode: -1}
		roundErr := a.playRound(ctx, c, agent, prompt, label, &round)
		if roundErr != nil {
			round.Error = roundErr.Error()
			if firstErr == nil {
				firstErr = roundErr
			}
		}
		r.Rounds = append(r.Rounds, round)
		r.ExitCode = round.ExitCode
		if round.Infrastructure != "completed" {
			r.Infrastructure = round.Infrastructure
		}
		if e := save(); e != nil {
			return e
		}
		fmt.Fprintf(a.Out, "Round %d (seed %d): %s%s\n", n, round.Seed, round.Infrastructure, outcomeText(round.Outcome))
		if ctx.Err() != nil {
			r.Infrastructure = "stopped"
			return ctx.Err()
		}
		// Every configured round is played even once the result is decided: the episode shows them all.
	}
	s, e := state(d)
	if e != nil {
		return e
	}
	s.Stage, s.Error = "run_completed", ""
	if e = saveState(d, s); e != nil {
		return e
	}
	if firstErr != nil {
		return harnessFailure(dest, firstErr)
	}
	if r.Infrastructure != "completed" {
		return fmt.Errorf("session %s; preserved artifacts at %s", r.Infrastructure, dest)
	}
	fmt.Fprintf(a.Out, "Recorded %s; objective=%s. Artifacts: %s\n", agent.ID, EvaluateRounds(c, r.Rounds).Outcome, dest)
	return nil
}

func outcomeText(o *GameOutcome) string {
	if o == nil {
		return "; no outcome"
	}
	if o.AgentWon {
		return "; agent won (" + o.Detail + ")"
	}
	return "; " + o.Detail
}

func (a *App) playRound(ctx context.Context, c config.Config, agent config.Agent, prompt, label string, round *RoundResult) error {
	if e := os.Mkdir(round.Dir, 0700); e != nil {
		return e
	}
	session := filepath.Join(round.Dir, "session")
	script, mcpEnv := gameServer(c, round.Seed, session, label)
	// The model works in an empty temporary directory; the MCP server runs from the repository.
	work, e := os.MkdirTemp("", "emergence-player-*")
	if e != nil {
		return e
	}
	defer os.RemoveAll(work)
	mcpc := map[string]any{"mcpServers": map[string]any{"agent-world": map[string]any{"command": "npm", "args": []string{"--silent", "--prefix", a.Root, "run", script}, "env": mcpEnv}}}
	mcpath := filepath.Join(work, "mcp.json")
	if e = storage.JSON(mcpath, mcpc); e != nil {
		return e
	}
	stdout, e := os.OpenFile(filepath.Join(round.Dir, "harness.stdout.log"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		return e
	}
	defer stdout.Close()
	stderr, e := os.OpenFile(filepath.Join(round.Dir, "harness.stderr.log"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if e != nil {
		return e
	}
	defer stderr.Close()
	runctx, stop := context.WithTimeout(ctx, time.Duration(c.Recording.MaxDurationMinutes)*time.Minute)
	defer stop()
	result, runErr := a.Harness.Run(runctx, harness.Request{Harness: agent.Harness, Model: agent.Model, Player: true, Dir: work, Prompt: prompt, MCPConfig: mcpath, Env: a.env("MCP_TIMEOUT=180000"), Stdout: stdout, Stderr: stderr})
	round.ExitCode = result.ExitCode
	var outcome GameOutcome
	if e := storage.ReadJSON(filepath.Join(session, "outcome.json"), &outcome); e == nil && outcome.Provider == c.Environment.Provider {
		round.Outcome = &outcome
	}
	switch {
	case errors.Is(runErr, context.DeadlineExceeded) || errors.Is(runctx.Err(), context.DeadlineExceeded):
		round.Infrastructure = "timed_out"
	case errors.Is(ctx.Err(), context.Canceled):
		round.Infrastructure = "stopped"
	case runErr != nil:
		round.Infrastructure = "failed"
	case round.Outcome == nil:
		round.Infrastructure = "aborted"
		return fmt.Errorf("round %d: the game server wrote no outcome.json", round.Round)
	default:
		round.Infrastructure = "completed"
	}
	return runErr
}

// RenderGame renders every round of a game take to video with the provider's recorder.
func (a *App) RenderGame(ctx context.Context, id string, o Options) error {
	d, c, e := a.load(id)
	if e != nil {
		return e
	}
	if !c.Environment.Game() {
		return fmt.Errorf("render is for game providers; use extract and produce for Minecraft episodes")
	}
	dest, e := a.runPath(d, o)
	if e != nil {
		return e
	}
	var r Run
	if e = storage.ReadJSON(filepath.Join(dest, "run.json"), &r); e != nil {
		return fmt.Errorf("no recorded take at %s: %w", dest, e)
	}
	if c.Environment.Provider != "detonarium" {
		return fmt.Errorf("render for %s is not wired yet; use its record script (npm run chess:record)", c.Environment.Provider)
	}
	for _, round := range r.Rounds {
		out := filepath.Join(round.Dir, "round.mp4")
		if _, e := os.Stat(filepath.Join(round.Dir, "session/replay.json")); e != nil {
			fmt.Fprintf(a.Out, "Round %d: no replay; skipped.\n", round.Round)
			continue
		}
		if _, e := os.Stat(out); e == nil {
			fmt.Fprintf(a.Out, "Round %d: %s exists; not replaced.\n", round.Round, out)
			continue
		}
		if o.DryRun {
			fmt.Fprintf(a.Out, "Would render round %d to %s.\n", round.Round, out)
			continue
		}
		args := []string{"--silent", "run", "detonarium:record", "--", round.Dir, "--out", out, "--title", fmt.Sprintf("Round %d", round.Round)}
		if e := a.npm(ctx, args); e != nil {
			return fmt.Errorf("round %d render failed: %w", round.Round, e)
		}
		fmt.Fprintf(a.Out, "Round %d: %s\n", round.Round, out)
	}
	return nil
}
