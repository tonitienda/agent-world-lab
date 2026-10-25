import {defineConfig} from 'vite';
import motionCanvas from '@motion-canvas/vite-plugin';
const episode=process.env.EPISODE_ID??'episode-001';
if(!/^episode-[a-zA-Z0-9-]+$/.test(episode))throw Error('Invalid EPISODE_ID');
export default defineConfig({plugins:[motionCanvas({project:[`./${episode}/project.ts`]})]});
