// Package episode implements explicit episode transitions over existing tools.
package episode

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/tonitienda/agent-world-lab/internal/config"
	"github.com/tonitienda/agent-world-lab/internal/environment"
	"github.com/tonitienda/agent-world-lab/internal/executor"
	"github.com/tonitienda/agent-world-lab/internal/harness"
	"github.com/tonitienda/agent-world-lab/internal/storage"
)

type App struct {
	Root    string
	Out     io.Writer
	Runner  executor.Runner
	Harness harness.Harness
	Env     []string
	lease   string
}
type Options struct {
	Agent, Take, Approval string
	ExpectedGoalHash      string
	Yes, DryRun           bool
}
type State struct {
	Stage          string    `json:"stage"`
	UpdatedAt      time.Time `json:"updated_at"`
	ValidationHash string    `json:"validation_hash,omitempty"`
	FrozenHash     string    `json:"frozen_hash,omitempty"`
	Error          string    `json:"error,omitempty"`
}
type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}
type Manifest struct {
	Version              int              `json:"version"`
	Spawn                Point            `json:"spawn"`
	Targets              map[string]Point `json:"targets"`
	Install              string           `json:"install"`
	Verify               string           `json:"verify"`
	Revision             string           `json:"revision"`
	RequiredCapabilities []string         `json:"required_capabilities"`
}
type Run struct {
	Version              int        `json:"version"`
	Agent                string     `json:"agent"`
	Harness              string     `json:"harness"`
	Model                string     `json:"model"`
	Take                 string     `json:"take"`
	Workflow             string     `json:"workflow"`
	Infrastructure       string     `json:"infrastructure"`
	Objective            Evaluation `json:"objective"`
	AgentReportedOutcome string     `json:"agent_reported_outcome"`
	GoalPrompt           string     `json:"goal_prompt,omitempty"`
	GoalHash             string     `json:"goal_hash,omitempty"`
	ScenarioHash         string     `json:"scenario_hash"`
	StartedAt            time.Time  `json:"started_at"`
	FinishedAt           *time.Time `json:"finished_at,omitempty"`
	DurationSeconds      float64    `json:"duration_seconds"`
	ExitCode             int        `json:"exit_code"`
	Artifacts            string     `json:"artifacts"`
	ProductionID         string     `json:"production_id,omitempty"`
	Error                string     `json:"error,omitempty"`
}
type Evaluation struct {
	Outcome  string `json:"outcome"`
	Evidence string `json:"evidence"`
}

func New(root string, out io.Writer) *App {
	r := executor.OS{}
	return &App{Root: root, Out: out, Runner: r, Harness: harness.CLI{Runner: r}}
}
func (a *App) dir(id string) (string, error) {
	if e := storage.ID(id); e != nil {
		return "", e
	}
	return storage.Path(a.Root, "episodes", id)
}
func (a *App) load(id string) (string, config.Config, error) {
	d, e := a.dir(id)
	if e != nil {
		return "", config.Config{}, e
	}
	c, e := config.Load(d)
	return d, c, e
}
func state(dir string) (State, error) {
	s := State{Stage: "created"}
	e := storage.ReadJSON(filepath.Join(dir, "state.json"), &s)
	if os.IsNotExist(e) {
		return s, nil
	}
	return s, e
}
func saveState(dir string, s State) error {
	s.UpdatedAt = time.Now().UTC()
	return storage.JSON(filepath.Join(dir, "state.json"), s)
}
func (a *App) env(extra ...string) []string {
	// Restrict inherited environment: never forward recording destinations, scenario
	// files, remote Minecraft endpoints, NODE_OPTIONS or harness customization hooks.
	allowed := map[string]bool{"PATH": true, "HOME": true, "TMPDIR": true, "LANG": true, "TERM": true, "USER": true, "LOGNAME": true, "SHELL": true, "EULA": true, "ANTHROPIC_API_KEY": true, "OPENAI_API_KEY": true, "CODEX_API_KEY": true}
	base := a.Env
	if base == nil {
		base = os.Environ()
	}
	env := []string{}
	for _, s := range base {
		k, _, _ := strings.Cut(s, "=")
		if allowed[k] {
			env = append(env, s)
		}
	}
	if a.lease != "" {
		env = append(env, "EMERGENCE_LEASE="+a.lease, "EMERGENCE_OWNER_PID="+strconv.Itoa(os.Getpid()))
	}
	return append(env, extra...)
}
func (a *App) command(ctx context.Context, dir, program string, args []string, env ...string) error {
	_, e := a.Runner.Run(ctx, executor.Request{Program: program, Args: args, Dir: dir, Env: a.env(env...), Stdout: a.Out, Stderr: a.Out})
	return e
}
func (a *App) npm(ctx context.Context, args []string, env ...string) error {
	return a.command(ctx, a.Root, "npm", args, env...)
}
func (a *App) bridge(ctx context.Context, dir, mode string, request any) error {
	f, e := os.CreateTemp(dir, ".bridge-*.json")
	if e != nil {
		return e
	}
	name := f.Name()
	f.Close()
	defer os.Remove(name)
	if e = storage.JSON(name, request); e != nil {
		return e
	}
	return a.command(ctx, a.Root, "node", []string{"--import", "tsx", filepath.Join(a.Root, "scripts/emergence-environment.ts"), mode, name})
}

// reserve composes with the existing Node lock, and spans all destructive steps.
func (a *App) reserve(ctx context.Context, dir string) (func(), error) {
	for _, part := range []string{"data/active-session.lock", "data/active-session.lock/owner.json", "data/active-session.lock/delegates", "data/active-session.lock/control.json", "data/active-session.lock/mcp-control-ready"} {
		if _, e := storage.Path(a.Root, part); e != nil {
			return nil, e
		}
	}

	b := make([]byte, 24)
	if _, e := rand.Read(b); e != nil {
		return nil, e
	}
	token := hex.EncodeToString(b)
	if e := a.bridge(ctx, dir, "lease", map[string]any{"pid": os.Getpid(), "token": token}); e != nil {
		return nil, e
	}
	a.lease = token
	return func() {
		p := filepath.Join(a.Root, "data/active-session.lock")
		var owner struct {
			Token string `json:"token"`
		}
		if storage.ReadJSON(filepath.Join(p, "owner.json"), &owner) == nil && owner.Token == token {
			// Transfer ownership to an unfinished delegate, including MCP startup
			// before mcp-control-ready exists. activeLock also recognizes delegates
			// if this supervisor is killed before it can run this cleanup.
			if entries, err := os.ReadDir(filepath.Join(p, "delegates")); err == nil {
				for _, entry := range entries {
					var child struct {
						PID  int    `json:"pid"`
						Kind string `json:"kind"`
					}
					if storage.ReadJSON(filepath.Join(p, "delegates", entry.Name()), &child) == nil && child.PID > 0 && syscall.Kill(child.PID, 0) == nil {
						_ = storage.JSON(filepath.Join(p, "owner.json"), map[string]any{"pid": child.PID, "kind": child.Kind})
						a.lease = ""
						return
					}
				}
			}
			// Keep the existing lock authoritative if an MCP process did not finalize.
			if b, err := os.ReadFile(filepath.Join(p, "mcp-control-ready")); err == nil {
				if pid, err := strconv.Atoi(strings.TrimSpace(string(b))); err == nil && syscall.Kill(pid, 0) == nil {
					_ = storage.JSON(filepath.Join(p, "owner.json"), map[string]any{"pid": pid, "kind": "MCP session (supervisor exited)"})
					a.lease = ""
					return
				}
			}
			_ = os.RemoveAll(p)
		}
		a.lease = ""
	}, nil
}

// Lock serializes CLI mutations, independently from the Minecraft session lease.
func (a *App) Lock() (func(), error) {
	p, e := storage.Path(a.Root, "data/emergence.lock")
	if e != nil {
		return nil, e
	}
	if e = os.MkdirAll(filepath.Dir(p), 0755); e != nil {
		return nil, e
	}
	f, e := os.OpenFile(p, os.O_CREATE|os.O_RDWR, 0600)
	if e != nil {
		return nil, e
	}
	if e = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); e != nil {
		f.Close()
		return nil, fmt.Errorf("another emergence operation is running")
	}
	return func() { _ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN); f.Close() }, nil
}
func (a *App) Init(id string) error {
	d, e := a.dir(id)
	if e != nil {
		return e
	}
	if !strings.HasPrefix(id, "episode-") {
		return fmt.Errorf("episode ID must start with episode-")
	}
	if e = os.MkdirAll(filepath.Dir(d), 0755); e != nil {
		return e
	}
	if e = os.Mkdir(d, 0755); e != nil {
		return fmt.Errorf("episode already exists or cannot be created: %w", e)
	}
	for name, text := range map[string]string{"episode.yaml": Starter(id), "level-design.md": DesignerPrompt, "goal.md": GoalPrompt} {
		if e = storage.Write(filepath.Join(d, name), []byte(text)); e != nil {
			return e
		}
	}
	return saveState(d, State{Stage: "created"})
}
func (a *App) Validate(id string) error {
	d, c, e := a.load(id)
	if e != nil {
		return e
	}
	for _, p := range []string{filepath.Join("production", c.Episode.ID), filepath.Join("production/public", c.Episode.ID)} {
		if _, e = storage.Path(a.Root, p); e != nil {
			return e
		}
	}
	fmt.Fprintf(a.Out, "Valid episode %s (%d agents); static validation only.\n", filepath.Base(d), len(c.Agents))
	return nil
}
func (a *App) Status(id string) error {
	d, _, e := a.load(id)
	if e != nil {
		return e
	}
	s, e := state(d)
	if e != nil {
		return e
	}
	next := map[string]string{"created": "scenario generate", "scenario_generated": "scenario validate --yes --approve-code <digest>", "scenario_validated": "scenario freeze", "scenario_frozen": "run --agent <id> --yes", "run_completed": "extract --agent <id>", "extracted": "review v2 edit plan, supply narration audio, then produce", "produced": "runs list"}
	fmt.Fprintf(a.Out, "%s: %s\nFrozen: %s\nNext: %s %s\n", id, s.Stage, s.FrozenHash, next[s.Stage], id)
	if s.Error != "" {
		fmt.Fprintln(a.Out, "Last error:", s.Error)
	}
	return a.List(id)
}
func (a *App) Doctor(ctx context.Context) error {
	checks := []struct {
		name string
		args []string
	}{{"go", []string{"version"}}, {"node", []string{"--version"}}, {"docker", []string{"compose", "version"}}, {"ffmpeg", []string{"-version"}}, {"claude", []string{"--version"}}, {"codex", []string{"--version"}}}
	for _, check := range checks {
		bounded, cancel := context.WithTimeout(ctx, 5*time.Second)
		var out bytes.Buffer
		_, err := a.Runner.Run(bounded, executor.Request{Program: check.name, Args: check.args, Dir: a.Root, Env: a.env(), Stdout: &out})
		cancel()
		if err != nil {
			fmt.Fprintf(a.Out, "%-10s unavailable: %v\n", check.name, err)
		} else {
			line, _, _ := strings.Cut(strings.TrimSpace(out.String()), "\n")
			fmt.Fprintf(a.Out, "%-10s %s\n", check.name, line)
		}
	}
	if b, err := os.ReadFile(filepath.Join(a.Root, ".env")); err == nil {
		accepted := regexp.MustCompile(`(?m)^\s*EULA\s*=\s*["']?TRUE["']?\s*$`).Match(b)
		fmt.Fprintf(a.Out, "Minecraft EULA acceptance in .env: %t\n", accepted)
	}

	for _, name := range []string{"go", "node", "npm", "docker", "ffmpeg", "ffprobe", "claude", "codex"} {
		p, e := exec.LookPath(name)
		if e != nil {
			fmt.Fprintf(a.Out, "%-10s missing (needed only for relevant stages)\n", name)
		} else {
			fmt.Fprintf(a.Out, "%-10s %s\n", name, p)
		}
	}
	for _, p := range []string{"node_modules/tsx", "production/node_modules", "packages/minecraft-recorder/node_modules", ".env"} {
		_, e := os.Stat(filepath.Join(a.Root, p))
		fmt.Fprintf(a.Out, "%-48s present=%t\n", p, e == nil)
	}
	fmt.Fprintln(a.Out, "Minecraft: Compose, EULA acceptance and matching version required for live stages. Harness authentication is checked when launched. Claude MCP-only supported; Codex fair gameplay blocked.")
	return ctx.Err()
}
func takeName(t string) (string, error) {
	if t == "" {
		t = "001"
	}
	if len(t) != 3 {
		return "", fmt.Errorf("take must be three digits, e.g. 001")
	}
	n, e := strconv.Atoi(t)
	if e != nil || n < 1 || n > 999 {
		return "", fmt.Errorf("take must be 001..999")
	}
	return "take-" + t, nil
}
func (a *App) runPath(d string, o Options) (string, error) {
	if e := storage.ID(o.Agent); e != nil {
		return "", fmt.Errorf("--agent is required: %w", e)
	}
	t, e := takeName(o.Take)
	if e != nil {
		return "", e
	}
	return storage.Path(d, "runs", o.Agent, t)
}
func (a *App) List(id string) error {
	d, e := a.dir(id)
	if e != nil {
		return e
	}
	root, e := storage.Path(d, "runs")
	if e != nil {
		return e
	}
	if _, e = os.Stat(root); os.IsNotExist(e) {
		fmt.Fprintln(a.Out, "No runs.")
		return nil
	}
	return filepath.WalkDir(root, func(p string, entry os.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink in runs: %s", p)
		}
		if entry.Name() != "run.json" {
			return nil
		}
		var r Run
		if e = storage.ReadJSON(p, &r); e != nil {
			return e
		}
		fmt.Fprintf(a.Out, "%s model=%s harness=%s %s workflow=%s infra=%s objective=%s %.1fs %s\n", r.Agent, r.Model, r.Harness, r.Take, r.Workflow, r.Infrastructure, r.Objective.Outcome, r.DurationSeconds, filepath.Dir(p))
		return nil
	})
}

func (a *App) environment(d string, c config.Config) environment.Provider {
	return environment.Minecraft{Config: c.Environment, NPM: a.npm, Bridge: func(ctx context.Context, mode string, q any) error { return a.bridge(ctx, d, mode, q) }}
}

// UnmarshalJSON requires explicit coordinates instead of silently treating a
// missing target/spawn coordinate as zero.
func (p *Point) UnmarshalJSON(b []byte) error {
	var raw struct {
		X *float64 `json:"x"`
		Y *float64 `json:"y"`
		Z *float64 `json:"z"`
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	if e := dec.Decode(&raw); e != nil {
		return e
	}
	if raw.X == nil || raw.Y == nil || raw.Z == nil {
		return fmt.Errorf("position requires explicit x, y and z")
	}
	p.X, p.Y, p.Z = *raw.X, *raw.Y, *raw.Z
	return nil
}
