import {makeProject} from '@motion-canvas/core';
import scene from './scene?scene';
import {episodeExporter} from '../src/exporter';
export default makeProject({scenes:[scene],audio:'/episode-003/generated/soundtrack.wav',plugins:[episodeExporter]});
