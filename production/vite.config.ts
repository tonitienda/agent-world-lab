import {defineConfig} from 'vite';
import motionCanvasModule from '@motion-canvas/vite-plugin';
import {fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';
import {join} from 'node:path';
// Local Node production helpers are intentionally separate from the browser scene.
// @ts-ignore JavaScript helpers are exercised by the production tests.
import {prepare} from './tools/pipeline.mjs';
// @ts-ignore
import {encoderPlugin} from './tools/encoder.mjs';
const episode=process.env.EPISODE_ID??'episode-001';
const production=fileURLToPath(new URL('.',import.meta.url));
export default defineConfig(()=>{
 const prepared=prepare(production,episode);
 return {plugins:[motionCanvasModule.default({project:`${production}${episode}/project.ts`}),encoderPlugin(production,episode,prepared)],server:{host:'127.0.0.1',fs:{allow:[production,realpathSync(join(production,'node_modules'))]}} };
});
