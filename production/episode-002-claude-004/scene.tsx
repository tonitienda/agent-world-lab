import plan from './edit-plan.json';
import {createEpisodeScene, type EpisodePlan} from '../src/scenes/episode';
export default createEpisodeScene(plan as EpisodePlan, 'episode-002-claude-004');
