import { castIds, characterName } from './QuestCast.js';
import { unavailableMessage } from './QuestAvailability.js';

/**
 * One step as everything that shows it reads it: the HUD objective, the quest
 * log and the saved game all take these words, this person and this hour, so
 * two surfaces can never name the same step differently.
 *
 * @returns { stepId, text, done, npcName, place, availability, window }
 */
export function stepView( { step, runtime, sim = null, timeMin = 0, done = false } ) {

	const text = step.narrative.playerHint;
	if ( done ) {

		return { stepId: step.stepId, text, done: true, npcName: null, place: null, availability: { available: true }, window: null };

	}

	const window = step.window ?? null;
	const availability = runtime.stepAvailability( step.stepId, timeMin );

	return {
		stepId: step.stepId,
		text,
		done: false,
		npcName: personName( sim, castIds( step.target, runtime )[ 0 ], runtime ),
		place: placeView( step, runtime, timeMin ),
		availability: availability.available
			? { available: true }
			: { ...availability, text: unavailableMessage( availability.reason, window ) },
		window
	};

}

/** The step's line in a list: its words, and who it is about when it is about somebody. */
export function stepLine( view ) {

	return view.npcName ? `${view.text} (${view.npcName})` : view.text;

}

function personName( sim, npcId, runtime ) {

	if ( ! npcId ) return null;
	const authored = characterName( runtime, npcId );
	if ( authored ) return `${authored.given} ${authored.family}`;
	if ( ! sim ) return null;
	try {

		const npc = sim.getNPC( npcId );
		return `${npc.name.given} ${npc.name.family}`;

	} catch {

		return null;

	}

}

/** Where the step sends the player: the runtime's live identity, named by the questline. */
function placeView( step, runtime, timeMin ) {

	const place = runtime.stepPlace( step.stepId, timeMin ) ?? null;
	if ( ! place ) return null;
	return { kind: place.kind, id: place.id, name: step.target.place?.name ?? null };

}
