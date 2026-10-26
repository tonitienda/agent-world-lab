import { defineConfig } from "vite"
import motionCanvasModule from "@motion-canvas/vite-plugin"

const motionCanvas = motionCanvasModule.default

const episode = process.env.EPISODE_ID ?? "episode-001"

export default defineConfig({
  plugins: [
    motionCanvas({
      project: `./${episode}/project.ts`,
    }),
  ],
})
