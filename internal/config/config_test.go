package config_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tonitienda/agent-world-lab/internal/config"
	"github.com/tonitienda/agent-world-lab/internal/episode"
)

func fixture(t *testing.T) string {
	t.Helper()
	d := filepath.Join(t.TempDir(), "episode-test")
	if e := os.Mkdir(d, 0755); e != nil {
		t.Fatal(e)
	}
	for n, s := range map[string]string{"episode.yaml": episode.Starter("episode-test"), "goal.md": "  First line\r\n\nSecond line\n", "level-design.md": "Build real terrain.\n"} {
		if e := os.WriteFile(filepath.Join(d, n), []byte(s), 0600); e != nil {
			t.Fatal(e)
		}
	}
	return d
}
func TestStrictSchema(t *testing.T) {
	for _, tt := range []struct{ name, old, new string }{
		{"unknown field", "version: 1", "version: 1\nsurprise: true"}, {"unknown nested", "preset: survival", "preset: survival\n  secret: true"}, {"duplicate", "version: 1", "version: 1\nversion: 1"}, {"version", "version: 1", "version: 2"}, {"seed overflow", "\"12345\"", "\"9223372036854775808\""}, {"provider", "provider: minecraft", "provider: other"}, {"preset", "preset: survival", "preset: creative"}, {"missing prompt", "prompt_file: goal.md", "prompt_file: absent.md"}, {"both prompts", "prompt_file: goal.md", "prompt_file: goal.md\n  prompt: hi"}, {"escape prompt", "prompt_file: goal.md", "prompt_file: ../goal.md"}, {"agent duplicate", "id: codex", "id: claude"}, {"harness", "harness: claude", "harness: custom"}, {"camera", "[agent-pov, observer, follow]", "[agent-pov]"}, {"timeout", "max_duration_minutes: 20", "max_duration_minutes: -1"}, {"evaluation", "type: reach_location", "type: agent_says_so"}, {"version name", "version: \"1.21.4\"", "version: \"latest\""}, {"multiple docs", "version: 1", "---\nversion: 1"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			d := fixture(t)
			b, _ := os.ReadFile(filepath.Join(d, "episode.yaml"))
			text := strings.Replace(string(b), tt.old, tt.new, 1)
			if tt.name == "multiple docs" {
				text += "\n---\nversion: 1\n"
			}
			os.WriteFile(filepath.Join(d, "episode.yaml"), []byte(text), 0600)
			if _, e := config.Load(d); e == nil {
				t.Fatal("accepted invalid configuration")
			}
		})
	}
}
func TestPromptContentAndDefaults(t *testing.T) {
	d := fixture(t)
	c, e := config.Load(d)
	if e != nil {
		t.Fatal(e)
	}
	got, e := c.Goal.Text(d)
	if e != nil || got != "  First line\r\n\nSecond line\n" {
		t.Fatalf("prompt changed: %q %v", got, e)
	}
	b, _ := os.ReadFile(filepath.Join(d, "episode.yaml"))
	text := strings.Replace(string(b), "prompt_file: goal.md", "prompt: |+\n    Inline\n    second\n", 1)
	os.WriteFile(filepath.Join(d, "episode.yaml"), []byte(text), 0600)
	c, e = config.Load(d)
	if e != nil {
		t.Fatal(e)
	}
	got, _ = c.Goal.Text(d)
	if got != "Inline\nsecond\n\n" {
		t.Fatalf("literal content changed: %q", got)
	}
	for _, text := range []string{"", " \n\t"} {
		os.WriteFile(filepath.Join(d, "goal.md"), []byte(text), 0600)
		if _, e = (config.Prompt{PromptFile: "goal.md"}).Text(d); e == nil {
			t.Fatal("accepted empty prompt")
		}
	}
}
func TestSymlinkPrompt(t *testing.T) {
	d := fixture(t)
	os.Remove(filepath.Join(d, "goal.md"))
	os.Symlink(filepath.Join(d, "level-design.md"), filepath.Join(d, "goal.md"))
	if _, e := config.Load(d); e == nil {
		t.Fatal("accepted symlink")
	}
}

// together is applied to the starter fixture: claude gets a role brief and both
// agents play at once.
var together = [][2]string{{"  - id: claude\n", "  - id: claude\n    goal_file: role.md\n"}, {"recording:", "play: together\nrecording:"}}

func togetherFixture(t *testing.T, edits [][2]string) string {
	t.Helper()
	d := fixture(t)
	b, _ := os.ReadFile(filepath.Join(d, "episode.yaml"))
	y := string(b)
	for _, e := range edits {
		y = strings.Replace(y, e[0], e[1], 1)
	}
	os.WriteFile(filepath.Join(d, "episode.yaml"), []byte(y), 0600)
	os.WriteFile(filepath.Join(d, "role.md"), []byte("You are claude.\n"), 0600)
	return d
}
func TestPlayTogetherConfiguration(t *testing.T) {
	d := togetherFixture(t, together)
	c, e := config.Load(d)
	if e != nil || !c.Together() {
		t.Fatal(e)
	}
	role, e := c.AgentGoal(d, c.Agents[0])
	if e != nil || role != "You are claude.\n\n  First line\r\n\nSecond line\n" {
		t.Fatalf("role goal must precede the shared goal: %q %v", role, e)
	}
	if shared, _ := c.AgentGoal(d, c.Agents[1]); shared != "  First line\r\n\nSecond line\n" {
		t.Fatalf("agent without goal_file receives the shared goal: %q", shared)
	}
	with := func(extra ...[2]string) [][2]string { return append(append([][2]string{}, together...), extra...) }
	for name, bad := range map[string][][2]string{
		"unknown mode":    {{"recording:", "play: versus\nrecording:"}},
		"reserved id":     with([2]string{"id: codex", "id: team"}),
		"invalid name":    with([2]string{"id: codex", "id: co-dex"}),
		"case collision":  with([2]string{"id: codex", "id: Claude"}),
		"missing goal":    {{"  - id: claude\n", "  - id: claude\n    goal_file: absent.md\n"}},
		"single together": with([2]string{"  - id: codex\n    harness: codex\n    model: configured-default\n", ""}),
	} {
		t.Run(name, func(t *testing.T) {
			if _, e := config.Load(togetherFixture(t, bad)); e == nil {
				t.Fatal("accepted invalid play configuration")
			}
		})
	}
}
