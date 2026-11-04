import {makeProject} from '@motion-canvas/core';
import scene from './scene?scene';
import {episodeExporter} from '../src/exporter';
export default makeProject({scenes:[scene],audio:'/episode-004-take-2/generated/soundtrack.wav',plugins:[episodeExporter]});
