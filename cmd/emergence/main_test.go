package main

import "testing"

func TestParse(t *testing.T) {
	p, e := parse([]string{"--root", "/tmp/repo", "run", "episode-test", "--take", "002", "--agent", "claude", "--yes"})
	if e != nil || p.id != "episode-test" || p.o.Take != "002" || !p.o.Yes {
		t.Fatal(p, e)
	}
	for _, a := range [][]string{{}, {"run"}, {"doctor", "episode-test"}, {"run", "episode-test", "--agent"}, {"run", "episode-test", "--agent", "a", "--agent", "b"}, {"run", "episode-test", "--wat"}} {
		if _, e := parse(a); e == nil {
			t.Fatal(a)
		}
	}
}

func TestParseGuidedPipeline(t *testing.T) {
	p, e := parse([]string{"pipeline", "--design", "codex", "--player", "claude", "--take", "002", "a path/experiment.yml"})
	if e != nil || p.command != "pipeline" || p.design != "codex" || p.player != "claude" || p.id != "a path/experiment.yml" || p.o.Take != "002" {
		t.Fatal(p, e)
	}
}
