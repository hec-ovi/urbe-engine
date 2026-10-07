import { draw } from './Carry.js';

/**
 * How a person decides a transfer when nobody can answer for them in their
 * own words: by their disposition after what they hold against the player
 * (Access `Regard.adjust`), their means and a seed (the person and the
 * minute), so the same moment goes the same way. With a model, the person
 * decides in their own words under the same rules.
 */

/** The odds an official takes a bribe, by disposition. */
const BRIBE = Object.freeze( { friendly: 0.5, neutral: 0.35, wary: 0.15, hostile: 0 } );
/** The most a person pays the player on their own, by means. */
const SPARE = Object.freeze( { short: 2, 'getting-by': 5, comfortable: 15, 'well-off': 40 } );
const OFFICIAL_PLACES = new Set( [ 'police', 'military', 'offices' ] );
const OFFICIAL_ROLES = new Set( [ 'security', 'clerk', 'office_worker', 'receptionist', 'executive' ] );

/**
 * Whether a person takes a thing the player hands them: a friendly person
 * yes; a neutral one too, unless it is somebody else's access card; a wary
 * one only food or drink, or something a story brings them; hostile, nothing.
 * @param options.kind the thing's kind (`goods` for food and drink, `access-card`, …)
 * @param options.story whether a story brings it to them
 * @param options.theirs whether the card is one of their own scopes
 */
export function acceptsThing( disposition, { kind = '', story = false, theirs = false } = {} ) {

	if ( disposition === 'friendly' ) return true;
	if ( disposition === 'neutral' ) return kind !== 'access-card' || theirs;
	if ( disposition === 'wary' ) return kind === 'goods' || story;
	return false;

}

/**
 * Whether a person takes credits the player holds out: hostile no; an
 * official is being bribed (`bribe`); friendly and neutral yes; wary only
 * when short or for a few credits.
 */
export function acceptsCredits( disposition, { amount = 0, official = false, means = 'getting-by', seed = '' } = {} ) {

	if ( disposition === 'hostile' ) return false;
	if ( official ) return bribe( disposition, { amount, means, seed } ).taken;
	if ( disposition === 'friendly' || disposition === 'neutral' ) return true;
	if ( disposition === 'wary' ) return means === 'short' || amount <= 5;
	return false;

}

/**
 * Whether an official takes credits held out to look away: likelier the
 * friendlier they are, the bigger the sum and the shorter their means;
 * never hostile. A refusal is noted against the player.
 */
export function bribe( disposition, { amount = 0, means = 'getting-by', seed = '' } = {} ) {

	if ( disposition === 'hostile' || ! ( disposition in BRIBE ) ) return { taken: false };
	const odds = BRIBE[ disposition ] + ( amount >= 20 ? 0.15 : 0 ) + ( means === 'short' ? 0.15 : 0 );
	return { taken: draw( seed, 'bribe' ) < odds };

}

/**
 * Whether a person pays the player a sum they ask for: a friendly person up
 * to what their means spare, a neutral one half that, never more than they
 * carry; nobody else.
 */
export function paysCredits( disposition, { amount = 0, carried = 0, means = 'getting-by' } = {} ) {

	const spare = SPARE[ means ] ?? SPARE[ 'getting-by' ];
	if ( ! ( amount >= 1 ) ) return false;
	if ( disposition === 'friendly' ) return amount <= Math.min( spare, carried );
	if ( disposition === 'neutral' ) return amount <= Math.min( Math.floor( spare / 2 ), carried );
	return false;

}

/** Whether a person buys a thing off the player: from a till anyone but the hostile; from their own pocket a friendly or neutral person who can pay. */
export function buysThing( disposition, { price = 0, carried = 0, till = false } = {} ) {

	if ( till ) return disposition !== 'hostile';
	return ( disposition === 'friendly' || disposition === 'neutral' ) && price <= carried;

}

/** Whether a person at a counter serves the player: anyone not hostile, so somebody the player stole from turns them away. */
export function sells( disposition ) {

	return disposition !== 'hostile';

}

/** Whether a person holds an office credits held out to them would bribe: an authority, or a desk or guard post at a police station, a compound or offices. */
export function isOfficial( npc, category, jobParcelType ) {

	if ( category === 'authority' ) return true;
	return OFFICIAL_PLACES.has( jobParcelType ) && OFFICIAL_ROLES.has( npc?.job?.role );

}
