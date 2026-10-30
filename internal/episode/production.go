package episode

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/tonitienda/agent-world-lab/internal/storage"
)

func (a *App) Extract(ctx context.Context, id string, o Options) error {
	d, _, p, r, e := a.recorded(id, o)
	if e != nil {
		return e
	}
	pid := productionID(id, o)
	out, e := storage.Path(a.Root, "production", pid)
	if e != nil {
		return e
	}
	media, e := storage.Path(a.Root, "production/public", pid)
	if e != nil {
		return e
	}
	if _, e = os.Stat(out); e == nil {
		if r.Workflow == "extracted" || r.Workflow == "produced" {
			fmt.Fprintln(a.Out, "Extraction already exists:", out)
			return nil
		}
		return fmt.Errorf("production directory already exists (possibly partial): %s; preserve/inspect it before retrying", out)
	}
	if _, e = os.Stat(media); !os.IsNotExist(e) {
		return fmt.Errorf("production media directory already exists: %s", media)
	}
	for _, name := range []string{"events.json", "metadata.json", "agent-pov.mp4", "observer.mp4", "follow.mp4"} {
		file, e := storage.Path(p, name)
		if e != nil {
			return e
		}
		st, e := os.Stat(file)
		if e != nil || !st.Mode().IsRegular() || st.Size() == 0 {
			return fmt.Errorf("missing recording artifact %s", file)
		}
	}
	if o.DryRun {
		fmt.Fprintf(a.Out, "Would extract %s into %s with every valid intention and hardlinked media.\n", p, out)
		return nil
	}
	goal := r.GoalPrompt
	if goal == "" {
		p, e := storage.Path(d, "frozen/goal.md")
		if e != nil {
			return e
		}
		b, e := os.ReadFile(p)
		if e != nil {
			return fmt.Errorf("missing recorded goal: %w", e)
		}
		goal = string(b)
	}
	bounded, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	if e = a.npm(bounded, []string{"run", "episode:plan", "--", p, pid, "--preserve-all-intentions", "--link-media"}, "EMERGENCE_GOAL_TEXT="+goal); e != nil {
		return e
	}
	// Project wrappers use the SAME shared Motion Canvas scene and exporter.
	files := map[string]string{
		"scene.tsx":           "import plan from './edit-plan.json';\nimport {createEpisodeScene, type EpisodePlan} from '../src/scenes/episode';\nexport default createEpisodeScene(plan as EpisodePlan, '" + pid + "');\n",
		"project.ts":          "import {makeProject} from '@motion-canvas/core';\nimport scene from './scene?scene';\nimport {episodeExporter} from '../src/exporter';\nexport default makeProject({scenes:[scene],audio:'/" + pid + "/generated/soundtrack.wav',plugins:[episodeExporter]});\n",
		"editorial-report.md": "# Editorial review required\n\nThe extractor produced a v1 draft. Review the actual event log and camera footage,\nthen author a version 2 edit-plan.json following production/README.md.\nAll valid public intentions are preserved in narration-manifest.json, even when\nno preview shot was selected. Keep their eventIndex associations.\nSupply the selected narration WAVs in production/public/" + pid + "/audio/.\nDo not imply the objective succeeded solely because the session finished.\n",
	}
	for name, value := range files {
		if e = storage.Write(filepath.Join(out, name), []byte(value)); e != nil {
			return e
		}
	}
	if e = storage.JSON(filepath.Join(out, "source.json"), map[string]any{"run": filepath.Join(p, "run.json"), "events": filepath.Join(p, "events.json"), "metadata": filepath.Join(p, "metadata.json"), "scenario_hash": r.ScenarioHash, "goal_hash": promptHash(goal)}); e != nil {
		return e
	}
	r.Workflow = "extracted"
	r.ProductionID = pid
	if e = storage.JSON(filepath.Join(p, "run.json"), r); e != nil {
		return e
	}
	s, e := state(d)
	if e != nil {
		return e
	}
	s.Stage = "extracted"
	if e = saveState(d, s); e != nil {
		return e
	}
	fmt.Fprintf(a.Out, "Extracted %s. Review the v1 draft and author v2, then supply WAVs before produce.\n", out)
	return nil
}
func (a *App) Produce(ctx context.Context, id, stage string, o Options) error {
	d, c, p, r, e := a.recorded(id, o)
	if e != nil {
		return e
	}
	if r.ProductionID == "" {
		return fmt.Errorf("extract this take first")
	}
	pid := productionID(id, o)
	if pid != r.ProductionID {
		return fmt.Errorf("run production identity mismatch")
	}
	out, e := storage.Path(a.Root, "production", pid)
	if e != nil {
		return e
	}
	if stage == "" {
		stage = "all"
	}
	if stage != "all" && stage != "validate" && stage != "render" && stage != "check" {
		return fmt.Errorf("stage must be validate, render, check or all")
	}
	var plan struct {
		Version  int `json:"version"`
		Segments []struct {
			Duration  float64 `json:"duration"`
			Narration []struct {
				Audio string `json:"audio"`
			} `json:"narration"`
		} `json:"segments"`
	}
	if e = storage.ReadJSON(filepath.Join(out, "edit-plan.json"), &plan); e != nil {
		return e
	}
	if plan.Version != 2 {
		return fmt.Errorf("editorial review required: %s/edit-plan.json is a v1 draft; author v2 using production/README.md and editorial-report.md", out)
	}
	if e = storage.PlainTree(out); e != nil {
		return e
	}
	media, e := storage.Path(a.Root, "production/public", pid)
	if e != nil {
		return e
	}
	if e = storage.PlainTree(media); e != nil {
		return e
	}
	duration := 0.0
	voices := 0
	for _, s := range plan.Segments {
		duration += s.Duration
		for _, v := range s.Narration {
			voices++
			audio, e := storage.Path(a.Root, "production/public", pid, "audio", v.Audio)
			if e != nil {
				return e
			}
			if st, e := os.Stat(audio); e != nil || st.Size() == 0 {
				return fmt.Errorf("missing narration audio %s; generate/export the exact WAV from narration-manifest.json with ElevenLabs or your chosen tool; no credentials are required by this CLI", audio)
			}
		}
	}
	if voices == 0 {
		return fmt.Errorf("v2 plan has no narration; select manifest lines and supply complete WAV clips before rendering")
	}
	if duration > float64(c.Production.MaxVideoDurationMinutes*60) {
		return fmt.Errorf("edit is %.1fs; configured maximum is %d minutes (re-edit without truncating narration)", duration, c.Production.MaxVideoDurationMinutes)
	}
	final, e := storage.Path(a.Root, "production/output", pid+".mp4")
	if e != nil {
		return e
	}
	if stage == "all" || stage == "render" {
		if _, e = os.Stat(final); e == nil {
			return fmt.Errorf("final MP4 already exists: %s; preserve it before an explicit rerender", final)
		}
	}
	if o.DryRun {
		fmt.Fprintf(a.Out, "Would run Motion Canvas stage %s with EPISODE_ID=%s.\n", stage, pid)
		return nil
	}
	bounded, cancel := context.WithTimeout(ctx, 2*time.Hour)
	defer cancel()
	env := []string{"EPISODE_ID=" + pid}
	if stage == "all" || stage == "validate" || stage == "render" {
		if e = a.npm(bounded, []string{"run", "episode:validate"}, env...); e != nil {
			return e
		}
	}
	if stage == "all" || stage == "render" {
		if e = a.npm(bounded, []string{"run", "episode:render"}, env...); e != nil {
			return e
		}
	}
	if stage == "all" || stage == "check" {
		if e = a.npm(bounded, []string{"run", "episode:check-render"}, env...); e != nil {
			return e
		}
		r.Workflow = "produced"
		if e = storage.JSON(filepath.Join(p, "run.json"), r); e != nil {
			return e
		}
		s, e := state(d)
		if e != nil {
			return e
		}
		s.Stage = "produced"
		return saveState(d, s)
	}
	return nil
}
