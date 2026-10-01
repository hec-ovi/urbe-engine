import standard from './lines.md?raw';
import { CompanionLines } from '../companion/CompanionLines.js';

/** Every key the contact and call lines hold. */
const KEYS = [
	'label-contact', 'label-meet', 'accept-contact',
	'refuse-contact-hostile', 'refuse-contact-wary', 'refuse-contact-neutral', 'refuse-contact-unavailable',
	'call-greeting', 'call-busy', 'notice-contact', 'name-here'
];
/** Seconds a call rings before the person answers it or it goes unanswered. */
export const RING_SECONDS = 2.5;
/** Seconds a busy person stays on the line to say so before hanging up. */
const BUSY_SECONDS = 4;

/** The contact and call lines ([lines.md](lines.md) by default). */
export function contactLines( markdown = standard ) {

	return new CompanionLines( markdown, { keys: KEYS } );

}

/**
 * Whether a person gives the player their number when nobody can ask the
 * model for them: as private as their home (Quests `willingTo`), so only a
 * friendly person does. The model, when there is one, decides in the
 * person's own words by the same rule and how the talk has gone.
 */
export function givesNumber( disposition ) {

	return disposition === 'friendly';

}

/**
 * How a contact takes a call now, decided by code from who they are and what
 * their day has them doing: `answered`, `no-answer` (dead, gone, or asleep),
 * `declined` (hostile: they let it ring out on purpose) or `busy` (at work and
 * not friendly: they pick up to say they cannot talk, then hang up).
 * @param npc the simulation's person, or null when it no longer holds them
 * @param disposition Quests `dispositionOf` the person
 * @param activity what their day has them doing now (`behaviorAt(...).activity`)
 */
export function answerOf( { npc, disposition, activity } ) {

	if ( ! npc || npc.flags?.dead ) return 'no-answer';
	if ( activity === 'sleeping' ) return 'no-answer';
	if ( disposition === 'hostile' ) return 'declined';
	if ( activity === 'working' && disposition !== 'friendly' ) return 'busy';
	return 'answered';

}

/**
 * One call, as the call screen shows it: it rings for RING_SECONDS, then the
 * person's answer is the call's state. `connected` counts the seconds talked;
 * `busy` hangs up by itself after BUSY_SECONDS. `update(seconds)` returns the
 * state the call came to this step, or null when it did not change.
 */
export class CallSession {

	constructor( { npcId, answer } ) {

		this.npcId = npcId;
		this.answer = answer;
		this.status = 'connecting';
		this.seconds = 0;
		this.talked = 0;
		/** When the call stopped being live, in its own seconds; null while it is. */
		this.endedAt = null;

	}

	update( seconds ) {

		this.seconds += seconds;
		if ( this.status === 'connected' ) this.talked += seconds;
		if ( this.status === 'connecting' && this.seconds >= RING_SECONDS ) return this.#to( this.answer === 'answered' ? 'connected' : this.answer );
		if ( this.status === 'busy' && this.seconds >= RING_SECONDS + BUSY_SECONDS ) return this.#to( 'ended' );
		return null;

	}

	/** The player hangs up, or the call ends otherwise; a call already over stays as it ended. */
	hangUp() {

		return [ 'connecting', 'connected', 'busy' ].includes( this.status ) ? this.#to( 'ended' ) : null;

	}

	/** The time talked as `m:ss`. */
	get duration() {

		const whole = Math.floor( this.talked );
		return `${Math.floor( whole / 60 )}:${String( whole % 60 ).padStart( 2, '0' )}`;

	}

	get live() {

		return this.status === 'connecting' || this.status === 'connected' || this.status === 'busy';

	}

	#to( status ) {

		this.status = status;
		if ( ! this.live && this.endedAt === null ) this.endedAt = this.seconds;
		return status;

	}

}
