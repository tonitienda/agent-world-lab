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
