import npcValues from '../../game/agents/schema/values.schema.json' with { type: 'json' };
import continuitySave from '../../game/agents/schema/continuity-save.schema.json' with { type: 'json' };
import simulationSave from '../../../../simulation/src/schemas/simulation-save.schema.json' with { type: 'json' };
import questValues from '../../game/quests/schema/values.schema.json' with { type: 'json' };
import questTransit from '../../game/quests/schema/transit-state.schema.json' with { type: 'json' };
import companionValues from '../../game/companion/schema/values.schema.json' with { type: 'json' };
import companionState from '../../game/companion/schema/companion-state.schema.json' with { type: 'json' };
import sceneState from '../../game/scenery/schema/scene-state.schema.json' with { type: 'json' };
import savedScenery from '../../game/scenery/schema/saved-scenery.schema.json' with { type: 'json' };
import npcState from '../schema/npc-state.schema.json' with { type: 'json' };
import dialogueMemory from '../schema/dialogue-memory.schema.json' with { type: 'json' };

/**
 * Every schema a game descriptor refers to outside its own file, added once to
 * each boundary that validates a descriptor or a save.
 */
export const DESCRIPTOR_SCHEMAS = Object.freeze( [
	npcValues, continuitySave, simulationSave, questValues, questTransit,
	companionValues, companionState, sceneState, savedScenery, npcState, dialogueMemory
] );
