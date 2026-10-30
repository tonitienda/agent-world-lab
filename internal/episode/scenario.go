package episode

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/tonitienda/agent-world-lab/internal/config"
	"github.com/tonitienda/agent-world-lab/internal/harness"
	"github.com/tonitienda/agent-world-lab/internal/storage"
)

type Frozen struct {
	Version                int       `json:"version"`
	Hash                   string    `json:"hash"`
	ConfigHash             string    `json:"config_hash"`
	CreatedAt              time.Time `json:"created_at"`
	MinecraftVersion       string    `json:"minecraft_version"`
	ImplementationRevision string    `json:"implementation_revision"`
}

func strictJSON(b []byte, v any) error {
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		return e
	}
	if e := d.Decode(new(any)); e != io.EOF {
		return fmt.Errorf("expected exactly one JSON object")
	}
	return nil
}
func manifest(dir string, c config.Config) (Manifest, string, error) {
	var m Manifest
	manifestPath, e := storage.Path(dir, "manifest.json")
	if e != nil {
		return m, "", e
	}
	b, e := os.ReadFile(manifestPath)
	if e != nil {
		return m, "", e
	}
	if e = strictJSON(b, &m); e != nil {
		return m, "", e
	}
	if m.Version != 1 || m.Revision == "" || !finite(m.Spawn) {
		return m, "", fmt.Errorf("manifest requires version 1, revision and finite spawn")
	}
	if len(m.Targets) == 0 {
		return m, "", fmt.Errorf("manifest requires targets")
	}
	for name, p := range m.Targets {
		if storage.ID(name) != nil || !finite(p) {
			return m, "", fmt.Errorf("invalid target %s", name)
		}
	}
	if _, ok := m.Targets[c.Evaluation.Target]; !ok {
		return m, "", fmt.Errorf("manifest.json targets must include evaluation.target %q from episode.yaml", c.Evaluation.Target)
	}
	for _, f := range []string{m.Install, m.Verify, "report.md"} {
		p, e := storage.Path(dir, f)
		if e != nil {
			return m, "", e
		}
		s, e := os.Stat(p)
		if e != nil {
			return m, "", e
		}
		if !s.Mode().IsRegular() || s.Size() == 0 {
			return m, "", fmt.Errorf("required regular nonempty artifact %s", f)
		}
	}
	if !strings.HasPrefix(m.Install, "implementation/") || !strings.HasSuffix(m.Install, ".mjs") || !strings.HasPrefix(m.Verify, "implementation/") || !strings.HasSuffix(m.Verify, ".mjs") {
		return m, "", fmt.Errorf("install and verify must be .mjs files in implementation/")
	}
	hash, e := storage.Hash(dir)
	return m, hash, e
}
func finite(p Point) bool {
	return !math.IsNaN(p.X) && !math.IsNaN(p.Y) && !math.IsNaN(p.Z) && !math.IsInf(p.X, 0) && !math.IsInf(p.Y, 0) && !math.IsInf(p.Z, 0) && math.Abs(p.X) <= 29999984 && math.Abs(p.Z) <= 29999984 && p.Y >= -64 && p.Y <= 320
}
func configHash(c config.Config, d string) (string, error) {
	level, e := c.LevelDesign.Text(d)
	if e != nil {
		return "", e
	}
	goal, e := c.Goal.Text(d)
	if e != nil {
		return "", e
	}
	return configInputsHash(c, level, goal)
}
func configInputsHash(c config.Config, level, goal string) (string, error) {
	b, e := json.Marshal([]any{c, level, goal})
	if e != nil {
		return "", e
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:]), nil
}
func (a *App) Generate(ctx context.Context, id, bundle string, o Options) error {
	d, c, e := a.load(id)
	if e != nil {
		return e
	}
	s, e := state(d)
	if e != nil {
		return e
	}
	if s.FrozenHash != "" {
		return fmt.Errorf("scenario is frozen; create a new episode for another scenario")
	}
	scenario, e := storage.Path(d, "scenario")
	if e != nil {
		return e
	}
	if _, e = os.Stat(scenario); !os.IsNotExist(e) {
		return fmt.Errorf("scenario already exists; review it or create a new episode (no automatic overwrite)")
	}
	if o.DryRun {
		fmt.Fprintf(a.Out, "Would generate scenario artifacts with %s; no world changes or generated code execution.\n", c.LevelDesign.Harness)
		return nil
	}
	work, e := os.MkdirTemp("", "emergence-designer-*")
	if e != nil {
		return e
	}
	defer os.RemoveAll(work)
	var content []byte
	if bundle != "" {
		content, e = os.ReadFile(bundle)
	} else {
		level, err := c.LevelDesign.Text(d)
		if err != nil {
			return err
		}
		goal, err := c.Goal.Text(d)
		if err != nil {
			return err
		}
		prompt := designerPrompt(c, level, goal)
		output := filepath.Join(work, "last-message.json")
		stdout := new(bytes.Buffer)
		// Logs remain private; the designer only emits inert JSON file contents.
		errlog, err := os.CreateTemp(d, "designer.*.stderr.log")
		if err != nil {
			return err
		}
		defer errlog.Close()
		timeout, cancel := context.WithTimeout(ctx, 20*time.Minute)
		defer cancel()
		_, e = a.Harness.Run(timeout, harness.Request{Harness: c.LevelDesign.Harness, Model: c.LevelDesign.Model, Dir: work, Prompt: prompt, Output: output, Env: a.env(), Stdout: stdout, Stderr: errlog})
		if e != nil {
			return fmt.Errorf("level designer failed; no world changed: %w", e)
		}
		if c.LevelDesign.Harness == "codex" {
			content, e = os.ReadFile(output)
		} else {
			content = stdout.Bytes()
		}
	}
	if e != nil {
		return e
	}
	var result struct {
		Files map[string]string `json:"files"`
	}
	if e = strictJSON(content, &result); e != nil {
		return fmt.Errorf("designer must return the JSON artifact bundle: %w", e)
	}
	if len(result.Files) < 4 || len(result.Files) > 64 {
		return fmt.Errorf("bundle must contain 4..64 files")
	}
	staging, e := os.MkdirTemp(d, ".scenario-*")
	if e != nil {
		return e
	}
	defer os.RemoveAll(staging)
	total := 0
	for name, text := range result.Files {
		if name != "manifest.json" && name != "report.md" && !strings.HasPrefix(name, "implementation/") {
			return fmt.Errorf("bundle artifact outside allowed contract: %s", name)
		}
		total += len(text)
		if total > 8*1024*1024 {
			return fmt.Errorf("scenario bundle exceeds 8 MiB")
		}
		p, err := storage.Path(staging, name)
		if err != nil {
			return err
		}
		if err = storage.Write(p, []byte(text)); err != nil {
			return err
		}
	}
	_, hash, e := manifest(staging, c)
	if e != nil {
		return fmt.Errorf("generated scenario rejected: %w; no scenario installed or world changed. Check episode.yaml and the design prompt, then rerun generation", e)
	}
	if e = os.Rename(staging, scenario); e != nil {
		return e
	}
	s.Stage = "scenario_generated"
	s.Error = ""
	if e = saveState(d, s); e != nil {
		return e
	}
	fmt.Fprintf(a.Out, "Generated inert scenario artifacts. Review %s\nApproval digest: %s\nNext: emergence scenario validate %s --yes --approve-code %s\n", scenario, hash, id, hash)
	return nil
}

func designerPrompt(c config.Config, level, goal string) string {
	// The designer has no repository tools: every configuration constraint it
	// needs must be provided here rather than assumed visible from episode.yaml.
	constraints, _ := json.Marshal(map[string]any{
		"episode_id":  c.Episode.ID,
		"environment": map[string]any{"provider": c.Environment.Provider, "preset": c.Environment.Preset, "seed": c.Environment.Seed, "minecraft_version": c.Environment.Minecraft.Version, "port": c.Environment.Minecraft.Port},
		"evaluation":  map[string]any{"type": c.Evaluation.Type, "target": c.Evaluation.Target, "radius": c.Evaluation.Radius},
	})
	contract := strings.ReplaceAll(Contract, "mainland-landmark", c.Evaluation.Target)
	return level + "\n\nPLAYER CHALLENGE (designer context only):\n" + goal +
		"\n\nREQUIRED EPISODE CONFIGURATION (from episode.yaml):\n" + string(constraints) +
		"\nmanifest.json targets MUST include the exact evaluation.target key above. Its coordinates must be the actual destination built by install and checked by verify. Preserve this identifier even if the design prompt uses a different display name. Coordinates in the schema example below are illustrative; choose coordinates for this design.\n" + contract
}
func (a *App) verify(ctx context.Context, d string, c config.Config, m Manifest) error {
	if e := a.environment(d, c).Preflight(ctx); e != nil {
		return fmt.Errorf("Minecraft preflight failed: %w", e)
	}
	report := filepath.Join(d, ".verification.json")
	if _, e := storage.Path(d, ".verification.json"); e != nil {
		return e
	}
	_ = os.Remove(report)
	script := filepath.Join(d, "scenario", m.Verify)
	if e := a.command(ctx, a.Root, "node", []string{"--import", "tsx", script}, "AGENT_ID=emergence-player", fmt.Sprint("MC_PORT=", c.Environment.Minecraft.Port), "EMERGENCE_REPO="+a.Root, "EMERGENCE_SCENARIO_DIR="+filepath.Join(d, "scenario"), "EMERGENCE_VALIDATION_REPORT="+report); e != nil {
		return fmt.Errorf("scenario verification failed: %w", e)
	}
	var r struct {
		Spawn        bool     `json:"spawn"`
		Target       bool     `json:"target"`
		Resources    bool     `json:"resources"`
		Capabilities bool     `json:"capabilities"`
		Recorder     bool     `json:"recorder"`
		Reachability string   `json:"reachability"`
		Evidence     []string `json:"evidence"`
	}
	if e := storage.ReadJSON(report, &r); e != nil {
		return fmt.Errorf("missing verification report: %w", e)
	}
	if !r.Spawn || !r.Target || !r.Resources || !r.Capabilities || !r.Recorder || len(r.Evidence) == 0 {
		return fmt.Errorf("scenario checks incomplete; see %s", report)
	}
	fmt.Fprintf(a.Out, "Automated checks passed. Reachability/design review: %s (operator review still required).\n", r.Reachability)
	return nil
}
func (a *App) ValidateScenario(ctx context.Context, id string, o Options) error {
	d, c, e := a.load(id)
	if e != nil {
		return e
	}
	s, e := state(d)
	if e != nil {
		return e
	}
	if s.FrozenHash != "" {
		_, _, e = a.frozen(d, c)
		return e
	}
	m, hash, e := manifest(filepath.Join(d, "scenario"), c)
	if e != nil {
		return e
	}
	fmt.Fprintf(a.Out, "Scenario artifacts valid; approval digest %s. This alone does not verify the world.\n", hash)
	if o.DryRun {
		return nil
	}
	if s.Stage == "scenario_validated" && s.ValidationHash == hash {
		fmt.Fprintln(a.Out, "Already validated; freeze rechecks the live world. No reset repeated.")
		return nil
	}
	if !o.Yes || o.Approval != hash {
		return fmt.Errorf("installation resets the active world and runs reviewed code; use --yes --approve-code %s after review, or --dry-run", hash)
	}
	release, e := a.reserve(ctx, d)
	if e != nil {
		return e
	}
	defer release()
	bounded, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	s.Stage = "scenario_generated"
	s.ValidationHash = ""
	s.Error = "installation/verification in progress; interruption requires explicit revalidation"
	if e = saveState(d, s); e != nil {
		return e
	}
	if e = a.environment(d, c).Prepare(bounded); e == nil {
		e = a.command(bounded, a.Root, "node", []string{"--import", "tsx", filepath.Join(d, "scenario", m.Install)}, "AGENT_ID=emergence-player", fmt.Sprint("MC_PORT=", c.Environment.Minecraft.Port), "EMERGENCE_REPO="+a.Root, "EMERGENCE_SCENARIO_DIR="+filepath.Join(d, "scenario"))
	}
	if e == nil {
		e = a.verify(bounded, d, c, m)
	}
	if e != nil {
		s.Error = e.Error()
		_ = saveState(d, s)
		return e
	}
	s.Stage = "scenario_validated"
	s.ValidationHash = hash
	s.Error = ""
	return saveState(d, s)
}
func (a *App) Freeze(ctx context.Context, id string, o Options) error {
	d, c, e := a.load(id)
	if e != nil {
		return e
	}
	s, e := state(d)
	if e != nil {
		return e
	}
	if s.FrozenHash != "" {
		_, f, e := a.frozen(d, c)
		if e == nil {
			fmt.Fprintln(a.Out, "Already frozen:", f.Hash)
		}
		return e
	}
	m, hash, e := manifest(filepath.Join(d, "scenario"), c)
	if e != nil {
		return e
	}
	if s.Stage != "scenario_validated" || s.ValidationHash != hash {
		return fmt.Errorf("scenario must pass live validation with current approved artifact digest before freezing")
	}
	if o.DryRun {
		fmt.Fprintln(a.Out, "Would reverify and stop Minecraft, then snapshot the installed world and all scenario inputs.")
		return nil
	}
	// Resume after a crash between writing the frozen manifest and state.json.
	if _, e = os.Stat(filepath.Join(d, "frozen.json")); e == nil {
		_, f, e := a.frozen(d, c)
		if e != nil {
			return e
		}
		s.Stage = "scenario_frozen"
		s.FrozenHash = f.Hash
		return saveState(d, s)
	}
	snapshot, e := storage.Path(d, "frozen")
	if e != nil {
		return e
	}
	if _, e = os.Stat(snapshot); !os.IsNotExist(e) {
		return fmt.Errorf("partial frozen directory exists; preserve and inspect it before retrying")
	}
	release, e := a.reserve(ctx, d)
	if e != nil {
		return e
	}
	defer release()
	bounded, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	if e = a.verify(bounded, d, c, m); e != nil {
		return e
	}
	if e = a.environment(d, c).Snapshot(bounded, snapshot); e != nil {
		return e
	}
	if e = storage.CopyTree(filepath.Join(d, "scenario"), filepath.Join(snapshot, "scenario")); e != nil {
		return e
	}
	goal, e := c.Goal.Text(d)
	if e != nil {
		return e
	}
	level, e := c.LevelDesign.Text(d)
	if e != nil {
		return e
	}
	for name, value := range map[string]any{"config.json": c, "manifest.json": m} {
		if e = storage.JSON(filepath.Join(snapshot, name), value); e != nil {
			return e
		}
	}
	for name, value := range map[string]string{"goal.md": goal, "level-design.md": level} {
		if e = storage.Write(filepath.Join(snapshot, name), []byte(value)); e != nil {
			return e
		}
	}
	h, e := storage.Hash(snapshot)
	if e != nil {
		return e
	}
	ch, e := configHash(c, d)
	if e != nil {
		return e
	}
	f := Frozen{Version: 1, Hash: h, ConfigHash: ch, CreatedAt: time.Now().UTC(), MinecraftVersion: c.Environment.Minecraft.Version, ImplementationRevision: m.Revision}
	if e = storage.JSON(filepath.Join(d, "frozen.json"), f); e != nil {
		return e
	}
	if e = filepath.WalkDir(snapshot, func(p string, entry os.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if entry.IsDir() {
			return os.Chmod(p, 0500)
		}
		return os.Chmod(p, 0400)
	}); e != nil {
		return e
	}
	s.Stage = "scenario_frozen"
	s.FrozenHash = h
	s.Error = ""
	if e = saveState(d, s); e != nil {
		return e
	}
	fmt.Fprintln(a.Out, "Frozen world:", h)
	return nil
}
func (a *App) frozen(d string, c config.Config) (string, Frozen, error) {
	var f Frozen
	p, e := storage.Path(d, "frozen")
	if e != nil {
		return "", f, e
	}
	if e = storage.ReadJSON(filepath.Join(d, "frozen.json"), &f); e != nil {
		return "", f, fmt.Errorf("freeze scenario first: %w", e)
	}
	hash, e := storage.Hash(p)
	if e != nil {
		return "", f, e
	}
	if f.Version != 1 || hash != f.Hash {
		return "", f, fmt.Errorf("frozen snapshot identity mismatch; refusing restoration")
	}
	// The original config hash includes the freeze-time goal. Retain that hash
	// format for existing snapshots, but allow the current goal to vary by take.
	// All other configuration and the private design must still match exactly.
	var original config.Config
	if e = storage.ReadJSON(filepath.Join(p, "config.json"), &original); e != nil {
		return "", f, e
	}
	level, e := c.LevelDesign.Text(d)
	if e != nil {
		return "", f, e
	}
	goal, e := os.ReadFile(filepath.Join(p, "goal.md"))
	if e != nil {
		return "", f, e
	}
	current := c
	current.Goal = original.Goal
	ch, e := configInputsHash(current, level, string(goal))
	if e != nil {
		return "", f, e
	}
	if ch != f.ConfigHash {
		return "", f, fmt.Errorf("scenario configuration or level design changed after freeze; create a new episode for world/evaluation changes. Only the player goal may vary between takes")
	}
	return p, f, nil
}
