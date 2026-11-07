// Package config owns the versioned, strict episode specification.
package config

import (
	"bytes"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/tonitienda/agent-world-lab/internal/storage"
	"gopkg.in/yaml.v3"

	"github.com/tonitienda/agent-world-lab/characters"
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
	// GoalFile is an optional role brief placed before the shared goal.
	// omitempty keeps older configs' frozen identity hash unchanged.
	GoalFile string `yaml:"goal_file" json:",omitempty"`
	// Character is an optional roster id (characters/roster.json) that sets the
	// agent's on-screen skin, nametag and narration voice. It is presentation
	// only: the frozen scenario hash ignores it, so casting may change per take.
	Character string `yaml:"character" json:",omitempty"`
}

// PlayTogether puts every agent in one world and one take, recorded under
// runs/TogetherTake. Each agent id is also its Minecraft username.
const (
	PlaySolo     = "solo"
	PlayTogether = "together"
	TogetherTake = "team"
)

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
	Agents []Agent `yaml:"agents"`
	// Play is "solo" (default: one agent per take, chosen with --agent) or
	// "together" (every agent plays at once). omitempty keeps solo hashes stable.
	Play      string `yaml:"play" json:",omitempty"`
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
	if e := c.validatePlay(dir); e != nil {
		return e
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

var minecraftName = regexp.MustCompile(`^[A-Za-z0-9_]{1,16}$`)

// Together reports whether every agent plays at once in one take.
func (c Config) Together() bool { return c.Play == PlayTogether }

func (c Config) validatePlay(dir string) error {
	if c.Play != "" && c.Play != PlaySolo && c.Play != PlayTogether {
		return fmt.Errorf("play must be solo or together")
	}
	cast := map[string]string{}
	for _, a := range c.Agents {
		if a.Character != "" {
			ch, e := characters.Lookup(a.Character)
			if e != nil {
				return fmt.Errorf("agent %s: %w", a.ID, e)
			}
			if h := ch.FamilyInfo().Harness; h != a.Harness {
				return fmt.Errorf("agent %s: character %s is a %s character; it needs harness %s, not %s", a.ID, ch.ID, ch.FamilyInfo().Display, h, a.Harness)
			}
			if other, taken := cast[a.Character]; taken {
				return fmt.Errorf("agents %s and %s both play character %s", other, a.ID, a.Character)
			}
			cast[a.Character] = a.ID
		}
		if a.GoalFile != "" {
			if _, e := (Prompt{PromptFile: a.GoalFile}).Text(dir); e != nil {
				return fmt.Errorf("agent %s goal_file: %w", a.ID, e)
			}
		}
	}
	if !c.Together() {
		return nil
	}
	if len(c.Agents) < 2 {
		return fmt.Errorf("play: together needs at least two agents")
	}
	names := map[string]bool{}
	for _, a := range c.Agents {
		if !minecraftName.MatchString(a.ID) {
			return fmt.Errorf("agent %q must be a valid Minecraft username to play together", a.ID)
		}
		if a.ID == TogetherTake {
			return fmt.Errorf("agent id %q is reserved for the shared take", TogetherTake)
		}
		// Minecraft usernames are case-insensitive.
		if names[strings.ToLower(a.ID)] {
			return fmt.Errorf("agents %q collide as Minecraft usernames", a.ID)
		}
		names[strings.ToLower(a.ID)] = true
	}
	return nil
}

// AgentGoal is an agent's role brief (if any), the shared episode goal and,
// when the agent plays a roster character, that character's voice brief.
func (c Config) AgentGoal(dir string, a Agent) (string, error) {
	goal, e := c.Goal.Text(dir)
	if e != nil {
		return "", e
	}
	if a.GoalFile != "" {
		role, e := (Prompt{PromptFile: a.GoalFile}).Text(dir)
		if e != nil {
			return "", e
		}
		goal = strings.TrimRight(role, "\n") + "\n\n" + strings.TrimLeft(goal, "\n")
	}
	if a.Character != "" {
		ch, e := characters.Lookup(a.Character)
		if e != nil {
			return "", e
		}
		goal = strings.TrimRight(goal, "\n") + "\n\n" + ch.Brief()
	}
	return goal, nil
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
