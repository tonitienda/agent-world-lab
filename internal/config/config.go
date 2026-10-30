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
}
type Config struct {
	Version int `yaml:"version"`
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
	if c.Recording.MaxDurationMinutes == 0 {
		c.Recording.MaxDurationMinutes = 20
	}
	if len(c.Recording.Cameras) == 0 {
		c.Recording.Cameras = []string{"agent-pov", "observer", "follow"}
	}
	if c.Production.Renderer == "" {
		c.Production.Renderer = "motion-canvas"
	}
	if c.Production.Narration == "" {
		c.Production.Narration = "manual"
	}
	if c.Production.MaxVideoDurationMinutes == 0 {
		c.Production.MaxVideoDurationMinutes = 10
	}
	if c.Evaluation.Radius == 0 {
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
	if c.Environment.Provider != "minecraft" {
		return fmt.Errorf("unsupported environment provider %q", c.Environment.Provider)
	}
	if c.Environment.Preset != "survival" && c.Environment.Preset != "superflat" {
		return fmt.Errorf("unsupported Minecraft preset")
	}
	if _, e := strconv.ParseInt(c.Environment.Seed, 10, 64); e != nil {
		return fmt.Errorf("environment.seed must be a signed 64-bit decimal integer")
	}
	if c.Environment.Minecraft.Port < 1024 || c.Environment.Minecraft.Port > 65535 {
		return fmt.Errorf("minecraft.port must be 1024..65535")
	}
	if !versionValid(c.Environment.Minecraft.Version) {
		return fmt.Errorf("invalid Minecraft version")
	}
	for name, p := range map[string]Prompt{"level_design": c.LevelDesign.Prompt, "goal": c.Goal} {
		if _, e := p.Text(dir); e != nil {
			return fmt.Errorf("%s: %w", name, e)
		}
	}
	if !supported(c.LevelDesign.Harness) {
		return fmt.Errorf("unsupported designer harness")
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
	if c.Evaluation.Type != "reach_location" || storage.ID(c.Evaluation.Target) != nil || math.IsNaN(c.Evaluation.Radius) || c.Evaluation.Radius <= 0 || c.Evaluation.Radius > 128 {
		return fmt.Errorf("evaluation requires reach_location, a named target, and radius in (0,128]")
	}
	if strings.Join(c.Recording.Cameras, ",") != "agent-pov,observer,follow" {
		return fmt.Errorf("current recorder requires cameras [agent-pov, observer, follow]")
	}
	if c.Recording.MaxDurationMinutes < 1 || c.Recording.MaxDurationMinutes > 1440 {
		return fmt.Errorf("recording duration must be 1..1440 minutes")
	}
	if c.Production.Renderer != "motion-canvas" || !contains([]string{"manual", "elevenlabs"}, c.Production.Narration) || c.Production.MaxVideoDurationMinutes < 1 {
		return fmt.Errorf("unsupported production configuration")
	}
	for _, p := range []string{"scenario", "runs", "state.json"} {
		if _, e := storage.Path(dir, p); e != nil {
			return e
		}
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
