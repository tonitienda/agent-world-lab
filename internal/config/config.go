// Package config owns the versioned, strict episode specification.
package config

import (
	"bytes"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/tonitienda/agent-world-lab/internal/storage"
	"gopkg.in/yaml.v3"
)

type Prompt struct {
	Prompt     string `yaml:"prompt" json:"prompt,omitempty"`
	PromptFile string `yaml:"prompt_file" json:"prompt_file,omitempty"`
}
type Designer struct {
	Prompt  `yaml:",inline"`
	Harness string `yaml:"harness"`
	Model   string `yaml:"model"`
}
type Agent struct {
	ID      string `yaml:"id"`
	Harness string `yaml:"harness"`
	Model   string `yaml:"model"`
}
type Environment struct {
	Provider  string `yaml:"provider"`
	Preset    string `yaml:"preset"`
	Seed      string `yaml:"seed"`
	Minecraft struct {
		Version string `yaml:"version"`
		Port    int    `yaml:"port"`
	} `yaml:"minecraft"`
	Detonarium *Detonarium `yaml:"detonarium"`
	Chess      *Chess      `yaml:"chess"`
}

// Detonarium configures the bomb arena: the agent is player 0 against CPU bots.
type Detonarium struct {
	Bots          []string `yaml:"bots"`
	AlertRadius   int      `yaml:"alert_radius"`
	MaxMacroTicks int      `yaml:"max_macro_ticks"`
}

// Chess configures one game against Stockfish. Elo is a number or "full" (no cap).
type Chess struct {
	Side       string `yaml:"side"`
	Elo        string `yaml:"elo"`
	MovetimeMs int    `yaml:"movetime_ms"`
	MaxIllegal int    `yaml:"max_illegal"`
}

// Game providers are fully defined by seed and settings: no designed scenario or world snapshot.
func (e Environment) Game() bool { return e.Provider == "detonarium" || e.Provider == "chess" }

type Config struct {
	Version int `yaml:"version"`
	// Rounds a take plays (game providers only); round n uses seed + n - 1.
	Rounds  int `yaml:"rounds"`
	Episode struct {
		ID    string `yaml:"id"`
		Title string `yaml:"title"`
	} `yaml:"episode"`
	Environment Environment `yaml:"environment"`
	LevelDesign Designer    `yaml:"level_design"`
	Goal        Prompt      `yaml:"goal"`
	Evaluation  struct {
		Type   string  `yaml:"type"`
		Target string  `yaml:"target"`
		Radius float64 `yaml:"radius"`
		// Wins needed for win_rounds.
		Wins int `yaml:"wins"`
	} `yaml:"evaluation"`
	Agents    []Agent `yaml:"agents"`
	Recording struct {
		Cameras            []string `yaml:"cameras"`
		MaxDurationMinutes int      `yaml:"max_duration_minutes"`
	} `yaml:"recording"`
	Production struct {
		Renderer                string `yaml:"renderer"`
		Narration               string `yaml:"narration"`
		MaxVideoDurationMinutes int    `yaml:"max_video_duration_minutes"`
	} `yaml:"production"`
}

func Load(dir string) (Config, error) { return loadFile(filepath.Join(dir, "episode.yaml"), true) }

// LoadFile accepts a user-specified YAML filename and resolves prompts beside it.
func LoadFile(path string) (Config, error) { return loadFile(path, false) }
func loadFile(path string, matchDirectory bool) (Config, error) {
	var c Config
	dir := filepath.Dir(path)
	p, e := storage.Path(dir, filepath.Base(path))
	if e != nil {
		return c, e
	}
	b, e := os.ReadFile(p)
	if e != nil {
		return c, e
	}
	d := yaml.NewDecoder(bytes.NewReader(b))
	d.KnownFields(true)
	if e = d.Decode(&c); e != nil {
		return c, fmt.Errorf("episode.yaml: %w", e)
	}
	var extra any
	if e = d.Decode(&extra); e != io.EOF {
		return c, fmt.Errorf("episode.yaml must contain exactly one document")
	}
	if c.Environment.Provider == "" {
		c.Environment.Provider = "minecraft"
	}
	if c.Environment.Game() {
		// Minecraft-only sections must be absent rather than silently ignored.
		if c.Environment.Preset != "" || c.Environment.Minecraft.Version != "" || c.Environment.Minecraft.Port != 0 {
			return c, fmt.Errorf("environment.preset and environment.minecraft apply only to provider minecraft")
		}
		if c.LevelDesign != (Designer{}) {
			return c, fmt.Errorf("level_design applies only to provider minecraft; %s games are defined by seed and settings", c.Environment.Provider)
		}
		applyGameDefaults(&c)
	} else {
		if c.Environment.Preset == "" {
			c.Environment.Preset = "survival"
		}
		if c.Environment.Minecraft.Port == 0 {
			c.Environment.Minecraft.Port = 25565
		}
		if c.Environment.Minecraft.Version == "" {
			c.Environment.Minecraft.Version = "1.21.4"
		}
		if c.LevelDesign.Harness == "" {
			c.LevelDesign.Harness = "claude"
		}
		if len(c.Recording.Cameras) == 0 {
			c.Recording.Cameras = []string{"agent-pov", "observer", "follow"}
		}
		if c.Production.Renderer == "" {
			c.Production.Renderer = "motion-canvas"
		}
	}
	if c.Rounds == 0 {
		c.Rounds = 1
	}
	if c.Recording.MaxDurationMinutes == 0 {
		c.Recording.MaxDurationMinutes = 20
	}
	if c.Production.Narration == "" {
		c.Production.Narration = "manual"
	}
	if c.Production.MaxVideoDurationMinutes == 0 {
		c.Production.MaxVideoDurationMinutes = 10
	}
	if c.Evaluation.Radius == 0 && !c.Environment.Game() {
		c.Evaluation.Radius = 4
	}
	if e = c.validate(dir, matchDirectory); e != nil {
		return c, e
	}
	return c, nil
}
func (p Prompt) Text(dir string) (string, error) {
	if (p.Prompt == "") == (p.PromptFile == "") {
		return "", fmt.Errorf("specify exactly one of prompt or prompt_file")
	}
	text := p.Prompt
	if p.PromptFile != "" {
		f, e := storage.Path(dir, p.PromptFile)
		if e != nil {
			return "", e
		}
		b, e := os.ReadFile(f)
		if e != nil {
			return "", e
		}
		text = string(b)
	}
	if strings.TrimSpace(text) == "" {
		return "", fmt.Errorf("prompt is empty")
	}
	return text, nil
}
func (c Config) Validate(dir string) error { return c.validate(dir, true) }
func (c Config) validate(dir string, matchDirectory bool) error {
	if c.Version != 1 {
		return fmt.Errorf("unsupported version %d; expected 1", c.Version)
	}
	if e := storage.ID(c.Episode.ID); e != nil {
		return e
	}
	if matchDirectory && c.Episode.ID != filepath.Base(dir) {
		return fmt.Errorf("episode.id must match directory name")
	}
	if !strings.HasPrefix(c.Episode.ID, "episode-") {
		return fmt.Errorf("episode.id must start with episode-")
	}
	if strings.TrimSpace(c.Episode.Title) == "" {
		return fmt.Errorf("episode.title is required")
	}
	if _, e := strconv.ParseInt(c.Environment.Seed, 10, 64); e != nil {
		return fmt.Errorf("environment.seed must be a signed 64-bit decimal integer")
	}
	switch c.Environment.Provider {
	case "minecraft":
		if e := c.validateMinecraft(dir); e != nil {
			return e
		}
	case "detonarium", "chess":
		if e := c.validateGame(); e != nil {
			return e
		}
	default:
		return fmt.Errorf("unsupported environment provider %q (use minecraft, detonarium or chess)", c.Environment.Provider)
	}
	if _, e := c.Goal.Text(dir); e != nil {
		return fmt.Errorf("goal: %w", e)
	}
	if len(c.Agents) == 0 {
		return fmt.Errorf("at least one agent is required")
	}
	seen := map[string]bool{}
	for _, a := range c.Agents {
		if e := storage.ID(a.ID); e != nil {
			return e
		}
		if seen[a.ID] {
			return fmt.Errorf("duplicate agent %s", a.ID)
		}
		seen[a.ID] = true
		if !supported(a.Harness) {
			return fmt.Errorf("unsupported harness %q", a.Harness)
		}
	}
	if c.Recording.MaxDurationMinutes < 1 || c.Recording.MaxDurationMinutes > 1440 {
		return fmt.Errorf("recording duration must be 1..1440 minutes")
	}
	if !contains([]string{"manual", "elevenlabs"}, c.Production.Narration) || c.Production.MaxVideoDurationMinutes < 1 {
		return fmt.Errorf("unsupported production configuration")
	}
	for _, p := range []string{"scenario", "runs", "state.json"} {
		if _, e := storage.Path(dir, p); e != nil {
			return e
		}
	}
	return nil
}
func (c Config) validateMinecraft(dir string) error {
	if c.Environment.Detonarium != nil || c.Environment.Chess != nil {
		return fmt.Errorf("environment.detonarium and environment.chess need the matching provider")
	}
	if c.Rounds != 1 {
		return fmt.Errorf("rounds applies only to game providers")
	}
	if c.Environment.Preset != "survival" && c.Environment.Preset != "superflat" {
		return fmt.Errorf("unsupported Minecraft preset")
	}
	if c.Environment.Minecraft.Port < 1024 || c.Environment.Minecraft.Port > 65535 {
		return fmt.Errorf("minecraft.port must be 1024..65535")
	}
	if !versionValid(c.Environment.Minecraft.Version) {
		return fmt.Errorf("invalid Minecraft version")
	}
	if _, e := c.LevelDesign.Prompt.Text(dir); e != nil {
		return fmt.Errorf("level_design: %w", e)
	}
	if !supported(c.LevelDesign.Harness) {
		return fmt.Errorf("unsupported designer harness")
	}
	if c.Evaluation.Type != "reach_location" || c.Evaluation.Wins != 0 || storage.ID(c.Evaluation.Target) != nil || math.IsNaN(c.Evaluation.Radius) || c.Evaluation.Radius <= 0 || c.Evaluation.Radius > 128 {
		return fmt.Errorf("evaluation requires reach_location, a named target, and radius in (0,128]")
	}
	if strings.Join(c.Recording.Cameras, ",") != "agent-pov,observer,follow" {
		return fmt.Errorf("current recorder requires cameras [agent-pov, observer, follow]")
	}
	if c.Production.Renderer != "motion-canvas" {
		return fmt.Errorf("unsupported production configuration")
	}
	return nil
}

func applyGameDefaults(c *Config) {
	if len(c.Recording.Cameras) == 0 {
		c.Recording.Cameras = []string{"board"}
	}
	if c.Production.Renderer == "" {
		c.Production.Renderer = "replay"
	}
	if d := c.Environment.Detonarium; d != nil {
		if d.AlertRadius == 0 {
			d.AlertRadius = 4
		}
		if d.MaxMacroTicks == 0 {
			d.MaxMacroTicks = 20
		}
	}
	if ch := c.Environment.Chess; ch != nil {
		if ch.Side == "" {
			ch.Side = "white"
		}
		if ch.Elo == "" {
			ch.Elo = "1500"
		}
		if ch.MovetimeMs == 0 {
			ch.MovetimeMs = 500
		}
		if ch.MaxIllegal == 0 {
			ch.MaxIllegal = 5
		}
	}
}

func (c Config) validateGame() error {
	p := c.Environment.Provider
	switch {
	case p == "detonarium" && (c.Environment.Detonarium == nil || c.Environment.Chess != nil):
		return fmt.Errorf("provider detonarium needs an environment.detonarium section and no environment.chess")
	case p == "chess" && (c.Environment.Chess == nil || c.Environment.Detonarium != nil):
		return fmt.Errorf("provider chess needs an environment.chess section and no environment.detonarium")
	}
	if d := c.Environment.Detonarium; d != nil {
		if len(d.Bots) < 1 || len(d.Bots) > 3 {
			return fmt.Errorf("environment.detonarium.bots must list 1 to 3 bots")
		}
		for _, b := range d.Bots {
			if !contains([]string{"passive", "wanderer", "hunter"}, b) {
				return fmt.Errorf("unknown Detonarium bot %q (use passive, wanderer or hunter)", b)
			}
		}
		if d.AlertRadius < 0 || d.AlertRadius > 20 || d.MaxMacroTicks < 1 || d.MaxMacroTicks > 400 {
			return fmt.Errorf("environment.detonarium needs alert_radius 0..20 and max_macro_ticks 1..400")
		}
	}
	if ch := c.Environment.Chess; ch != nil {
		if ch.Side != "white" && ch.Side != "black" {
			return fmt.Errorf("environment.chess.side must be white or black")
		}
		if n, e := strconv.Atoi(ch.Elo); ch.Elo != "full" && (e != nil || n < 1320 || n > 3190) {
			return fmt.Errorf("environment.chess.elo must be 1320..3190 or full")
		}
		if ch.MovetimeMs < 10 || ch.MovetimeMs > 60000 || ch.MaxIllegal < 1 || ch.MaxIllegal > 50 {
			return fmt.Errorf("environment.chess needs movetime_ms 10..60000 and max_illegal 1..50")
		}
	}
	if c.Rounds < 1 || c.Rounds > 20 {
		return fmt.Errorf("rounds must be 1..20")
	}
	switch c.Evaluation.Type {
	case "win_match":
		if c.Rounds != 1 || c.Evaluation.Wins != 0 {
			return fmt.Errorf("win_match is for a single round; use win_rounds with wins for several")
		}
	case "win_rounds":
		if c.Evaluation.Wins < 1 || c.Evaluation.Wins > c.Rounds {
			return fmt.Errorf("win_rounds needs evaluation.wins between 1 and rounds")
		}
	default:
		return fmt.Errorf("game providers evaluate win_match or win_rounds, not %q", c.Evaluation.Type)
	}
	if c.Evaluation.Target != "" || c.Evaluation.Radius != 0 {
		return fmt.Errorf("evaluation.target and radius apply only to reach_location")
	}
	for _, a := range c.Agents {
		if a.Harness != "claude" {
			return fmt.Errorf("game providers support the claude harness only (MCP-only isolation)")
		}
	}
	if strings.Join(c.Recording.Cameras, ",") != "board" {
		return fmt.Errorf("game providers record a single [board] camera, rendered from the replay")
	}
	if c.Production.Renderer != "replay" {
		return fmt.Errorf("game providers render with production.renderer: replay")
	}
	return nil
}

func versionValid(s string) bool {
	for _, x := range strings.Split(s, ".") {
		if n, e := strconv.Atoi(x); e != nil || n < 0 || x == "" || strings.ContainsAny(x, "+-") {
			return false
		}
	}
	return len(strings.Split(s, ".")) == 3
}
func supported(s string) bool { return s == "claude" || s == "codex" }
func contains(a []string, s string) bool {
	for _, x := range a {
		if x == s {
			return true
		}
	}
	return false
}
