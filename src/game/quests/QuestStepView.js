import { castIds, characterName } from './QuestCast.js';
import { unavailableMessage } from './QuestAvailability.js';
import { nextQuestWindow } from './QuestWait.js';

/**
 * One step as everything that shows it reads it: the HUD objective, the quest
 * log and the saved game all take these words, this person and this hour, so
 * two surfaces can never name the same step differently.
 *
 * @returns { stepId, text, state, done, npcName, place, availability, window }
 */
export function stepView( { step, runtime, sim = null, timeMin = 0, done = false, cancelled = false } ) {

	const text = step.narrative.playerHint;
	if ( done || cancelled ) {

		return {
			stepId: step.stepId, text, state: cancelled ? 'cancelled' : 'done', done,
			npcName: null, place: null, availability: { available: ! cancelled }, window: null
		};

	}

	const window = step.window ?? null;
	const physical = runtime.stepAvailability( step.stepId, timeMin );
	// A closed appointment often has nobody at its venue yet. Explain the
	// authored opening before that temporary absence so the player can wait.
	// This changes presentation only; interaction still requires live presence.
	const placement = runtime.stepPlacementAvailability( step.stepId, timeMin );
	const availability = placement.reason === 'outside_window' ? placement : physical;

	return {
		stepId: step.stepId,
		text,
		state: availability.available ? 'active' : 'locked',
		done: false,
		npcName: personName( sim, castIds( step.target, runtime )[ 0 ], runtime ),
		place: placeView( step, runtime, timeMin ),
		availability: availability.available
			? { available: true }
			: { ...availability, text: unavailableMessage( availability.reason, window ) },
		window,
		...( availability.reason === 'outside_window' ? { wait: nextQuestWindow( window, timeMin ) } : {} )
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
