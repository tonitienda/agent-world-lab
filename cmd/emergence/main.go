// emergence orchestrates existing Minecraft and production tools.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/tonitienda/agent-world-lab/internal/episode"
)

const help = `emergence — reproducible episode orchestration

Usage: emergence [--root PATH] COMMAND [EPISODE] [OPTIONS]
  pipeline YAML --design codex --player claude [--take 001]
                                 guided prompts, browser previews, audio pause, render
  episode new ID                 create YAML and separate prompts (never overwrite)
  episode validate ID            strict, static validation only
  scenario generate ID           generate inert scenario code for review
    --bundle FILE                import an existing designer JSON bundle instead
  scenario validate ID           inspect digest; install/verify after approval
    --yes --approve-code DIGEST  authorize reset and exact reviewed code
  scenario freeze ID             reverify and snapshot the actual installed world
  run ID --agent ID [--take 001] --yes
                                 restore frozen world, record an isolated take
  runs list ID                   list infrastructure and objective outcomes
  extract ID --agent ID [--take 001]
                                 extract all intentions and v1 editorial draft
  produce ID --agent ID [--take 001] [--stage validate|render|check|all]
                                 require reviewed v2 plan and narration WAVs
  status ID                      current lifecycle, runs, next actions
  doctor                         report relevant local prerequisites

--dry-run is available on scenario, run, extract and produce commands.
World installation/restoration require --yes. Freeze stops Minecraft but never
resets it. Generated code additionally requires its exact --approve-code digest.
Take directories and completed MP4s are never overwritten. No automatic retries.
Claude players receive MCP tools only; Codex gameplay is blocked until an external
filesystem isolation boundary is available. See docs/emergence-cli.md.
`

type parsed struct {
	root, command, sub, id, bundle, stage, design, player string
	o                                                     episode.Options
}

func parse(args []string) (parsed, error) {
	p := parsed{}
	pos := []string{}
	seen := map[string]bool{}
	for i := 0; i < len(args); i++ {
		s := args[i]
		if !strings.HasPrefix(s, "--") {
			pos = append(pos, s)
			continue
		}
		if seen[s] {
			return p, fmt.Errorf("duplicate option %s", s)
		}
		seen[s] = true
		switch s {
		case "--yes":
			p.o.Yes = true
		case "--dry-run":
			p.o.DryRun = true
		case "--root", "--agent", "--take", "--approve-code", "--bundle", "--stage", "--design", "--player":
			if i+1 == len(args) || strings.HasPrefix(args[i+1], "--") {
				return p, fmt.Errorf("missing value for %s", s)
			}
			i++
			v := args[i]
			switch s {
			case "--root":
				p.root = v
			case "--agent":
				p.o.Agent = v
			case "--take":
				p.o.Take = v
			case "--approve-code":
				p.o.Approval = v
			case "--bundle":
				p.bundle = v
			case "--stage":
				p.stage = v
			case "--design":
				p.design = v
			case "--player":
				p.player = v
			}
		default:
			return p, fmt.Errorf("unknown option %s", s)
		}
	}
	if len(pos) == 0 {
		return p, fmt.Errorf("a command is required")
	}
	p.command = pos[0]
	pos = pos[1:]
	if p.command == "episode" || p.command == "scenario" || p.command == "runs" {
		if len(pos) == 0 {
			return p, fmt.Errorf("subcommand required")
		}
		p.sub = pos[0]
		pos = pos[1:]
	}
	if p.command != "doctor" {
		if len(pos) != 1 {
			return p, fmt.Errorf("one episode ID is required")
		}
		p.id = pos[0]
	} else if len(pos) != 0 {
		return p, fmt.Errorf("doctor accepts no episode ID")
	}
	return p, nil
}
func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, "emergence:", e)
		os.Exit(1)
	}
}
func run() error {
	for _, s := range os.Args[1:] {
		if s == "--help" || s == "-h" {
			fmt.Print(help)
			return nil
		}
	}
	p, e := parse(os.Args[1:])
	if e != nil {
		return e
	}
	if p.command == "pipeline" && p.o.Yes {
		return fmt.Errorf("pipeline uses explained interactive approvals; omit --yes")
	}

	if p.root == "" {
		p.root, e = os.Getwd()
		if e != nil {
			return e
		}
		for {
			if _, e = os.Stat(filepath.Join(p.root, "compose.yaml")); e == nil {
				break
			}
			parent := filepath.Dir(p.root)
			if parent == p.root {
				return fmt.Errorf("repository not found; pass --root PATH")
			}
			p.root = parent
		}
	}
	p.root, e = filepath.Abs(p.root)
	if e != nil {
		return e
	}
	a := episode.New(p.root, os.Stdout)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	mutating := p.command == "pipeline" || p.command == "run" || p.command == "extract" || p.command == "produce" || p.command == "scenario" || (p.command == "episode" && p.sub == "new")
	if mutating && !p.o.DryRun {
		release, e := a.Lock()
		if e != nil {
			return e
		}
		defer release()
	}
	switch p.command {
	case "pipeline":
		return a.Pipeline(ctx, p.id, episode.PipelineOptions{Designer: p.design, Player: p.player, Take: p.o.Take, DryRun: p.o.DryRun, Input: os.Stdin})
	case "episode":
		switch p.sub {
		case "new":
			if p.o.DryRun {
				return fmt.Errorf("episode new does not accept --dry-run")
			}
			return a.Init(p.id)
		case "validate":
			return a.Validate(p.id)
		}
	case "scenario":
		switch p.sub {
		case "generate":
			return a.Generate(ctx, p.id, p.bundle, p.o)
		case "validate":
			return a.ValidateScenario(ctx, p.id, p.o)
		case "freeze":
			return a.Freeze(ctx, p.id, p.o)
		}
	case "run":
		return a.RunAgent(ctx, p.id, p.o)
	case "runs":
		if p.sub == "list" {
			return a.List(p.id)
		}
	case "extract":
		return a.Extract(ctx, p.id, p.o)
	case "produce":
		return a.Produce(ctx, p.id, p.stage, p.o)
	case "status":
		return a.Status(p.id)
	case "doctor":
		return a.Doctor(ctx)
	}
	return fmt.Errorf("unknown command %s %s; run emergence --help", p.command, p.sub)
}
