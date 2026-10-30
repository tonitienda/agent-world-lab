package episode

import (
	"testing"

	"github.com/tonitienda/agent-world-lab/internal/config"
)

func mustConfig(t *testing.T, d string) config.Config {
	t.Helper()
	c, e := config.Load(d)
	if e != nil {
		t.Fatal(e)
	}
	return c
}
