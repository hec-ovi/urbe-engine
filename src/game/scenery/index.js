import capabilities from './capabilities.json' with { type: 'json' };

export { SceneryDirector } from './SceneryDirector.js';
export { SceneryRenderer } from './SceneryRenderer.js';
export { SceneryCompiler } from './SceneryCompiler.js';
export { ScenePlaceResolver } from './ScenePlaceResolver.js';
export { SceneryBoundary } from './SceneryBoundary.js';
export { SceneryError } from './SceneryError.js';
export { POSE_IDS, assertPoseClips, poseOf } from './PoseCatalog.js';
export { evaluate, unknownReferences } from './SceneConditions.js';

/** What the engine stages, as it declares it to Quests in `hostCapabilities.scenery`. */
export const sceneryCapabilities = capabilities;
