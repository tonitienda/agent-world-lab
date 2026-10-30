// Package environment is the simulation boundary; it delegates Minecraft work to
// the repository's existing Node/Docker tooling rather than implementing a world.
package environment

import (
	"context"
	"fmt"

	"github.com/tonitienda/agent-world-lab/internal/config"
)

type Provider interface {
	Prepare(context.Context) error
	Preflight(context.Context) error
	Snapshot(context.Context, string) error
	Restore(context.Context, string) error
}
type Minecraft struct {
	Config config.Environment
	NPM    func(context.Context, []string, ...string) error
	Bridge func(context.Context, string, any) error
}

func (m Minecraft) env() []string {
	return []string{"MC_VERSION=" + m.Config.Minecraft.Version, fmt.Sprint("MC_PORT=", m.Config.Minecraft.Port)}
}
func (m Minecraft) Prepare(ctx context.Context) error {
	return m.NPM(ctx, []string{"run", "world:reset", "--", "--yes", "--preset", m.Config.Preset, "--seed", m.Config.Seed}, m.env()...)
}
func (m Minecraft) Preflight(ctx context.Context) error {
	return m.NPM(ctx, []string{"run", "world:preflight", "--", "--profile", m.Config.Preset}, m.env()...)
}
func (m Minecraft) request() map[string]any {
	return map[string]any{"seed": m.Config.Seed, "preset": m.Config.Preset, "version": m.Config.Minecraft.Version, "port": m.Config.Minecraft.Port}
}
func (m Minecraft) Snapshot(ctx context.Context, destination string) error {
	q := m.request()
	q["destination"] = destination
	return m.Bridge(ctx, "snapshot", q)
}
func (m Minecraft) Restore(ctx context.Context, source string) error {
	q := m.request()
	q["source"] = source
	return m.Bridge(ctx, "restore", q)
}
