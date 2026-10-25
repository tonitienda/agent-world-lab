import {defineConfig} from 'vite';
import motionCanvas from '@motion-canvas/vite-plugin';
import {readdirSync, existsSync} from 'node:fs';
const projects=readdirSync('production',{withFileTypes:true})
  .filter(dir=>dir.isDirectory() && /^episode-/.test(dir.name))
  .map(dir=>`./${dir.name}/project.ts`)
  .filter(path=>existsSync('production/'+path.slice(2)));
export default defineConfig({plugins:[motionCanvas({project:projects})]});
