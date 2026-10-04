/**
 * How the people the player has wronged take to them now: a person who
 * caught the player lifting their card thinks less of them, one step down
 * the disposition ladder per time, saved with the game.
 */

const LADDER = [ 'hostile', 'wary', 'neutral', 'friendly' ];
/** How readily a person notices a hand in their pocket, by how they take to strangers: the guarded watch. */
const WATCHFUL = Object.freeze( { hostile: 0.7, wary: 0.6, neutral: 0.4, friendly: 0.3 } );
/** Facing the player within this of straight on, a person sees the hand coming. */
const SEES = Math.PI / 2;

export class Regard {

	constructor() {

		this.drops = new Map();

	}

	/** One step down for this person, as of the game minute. */
	drop( npcId, atMin ) {

		const known = this.drops.get( npcId );
		this.drops.set( npcId, { npcId, drop: Math.min( LADDER.length - 1, ( known?.drop ?? 0 ) + 1 ), atMin } );

	}

	/** How many steps this person has come down. */
	of( npcId ) {

		return this.drops.get( npcId )?.drop ?? 0;

	}

	/** A person's disposition (Quests `dispositionOf`) after what they hold against the player. */
	adjust( disposition, npcId ) {

		const at = LADDER.indexOf( disposition );
		if ( at < 0 ) return disposition;
		return LADDER[ Math.max( 0, at - this.of( npcId ) ) ];

	}

	/** `[{ npcId, drop, atMin }]`, by npcId: the save's `access.regard`. */
	serialize() {

		return [ ...this.drops.values() ].sort( ( a, b ) => a.npcId.localeCompare( b.npcId ) ).map( ( entry ) => ( { ...entry } ) );

	}

	restore( saved = [] ) {

		this.drops.clear();
		for ( const entry of saved ) if ( entry?.npcId && Number.isInteger( entry.drop ) && entry.drop > 0 ) this.drops.set( entry.npcId, { ...entry } );
		return this;

	}

}

/**
 * Whether a person notices the player lifting a card off them: always when
 * they face the player, else by how watchful they are, decided by a seed
 * (the person and the minute), so a reload of the same moment goes the same way.
 * @param heading the person's heading (radians, three's +Y convention: 0 faces +Z)
 * @param toPlayer `[dx, dz]` from the person to the player
 */
export function notices( { disposition, heading = 0, toPlayer = [ 0, 0 ], seed = '' } ) {

	const facing = [ Math.sin( heading ), Math.cos( heading ) ];
	const length = Math.hypot( toPlayer[ 0 ], toPlayer[ 1 ] );
	if ( length > 1e-6 ) {

		const cosine = ( facing[ 0 ] * toPlayer[ 0 ] + facing[ 1 ] * toPlayer[ 1 ] ) / length;
		if ( Math.acos( Math.max( - 1, Math.min( 1, cosine ) ) ) < SEES / 2 ) return true;

	}
	return chance( seed ) < ( WATCHFUL[ disposition ] ?? 0.5 );

}

/** The odds a hand gets a card out unfelt: from behind, from the side, and in front of the person, where they see it. */
const LIFTS = Object.freeze( { behind: 0.3, side: 0.12, front: 0.03 } );
/** A person busy with something else (talking, working, on the phone) is easier: this much better odds, this much less watchful. */
const DISTRACTED = 0.15;
/** A failed try is a hand felt: noticed this often from behind or the side, always in front. */
const FUMBLE = 0.8;
/** Beside the person's own watchfulness, how often the side or the front gives the hand away when it works. */
const SEEN = Object.freeze( { side: 0.6, front: 1 } );

/**
 * One try at lifting a card off a person: whether the card comes out
 * (`lifted`) and whether they feel or see it (`noticed`). The odds are low
 * and worst in front of them, better from behind or while they are busy
 * with something else; a failed try is noticed most of the time, a lifted
 * card by how watchful they are, the side and the front giving it away.
 * Decided by a seed (the person and the minute), so a reload of the same
 * moment goes the same way.
 * @param heading the person's heading (radians, three's +Y convention: 0 faces +Z)
 * @param toPlayer `[dx, dz]` from the person to the player
 * @param distracted the person is busy with something else
 */
export function pickpocket( { disposition, heading = 0, toPlayer = [ 0, 0 ], distracted = false, seed = '' } ) {

	const facing = [ Math.sin( heading ), Math.cos( heading ) ];
	const length = Math.hypot( toPlayer[ 0 ], toPlayer[ 1 ] );
	const angle = length > 1e-6
		? Math.acos( Math.max( - 1, Math.min( 1, ( facing[ 0 ] * toPlayer[ 0 ] + facing[ 1 ] * toPlayer[ 1 ] ) / length ) ) )
		: Math.PI;
	const side = angle < SEES / 2 ? 'front' : angle < Math.PI * 2 / 3 ? 'side' : 'behind';
	const lifted = chance( `${seed}|lift` ) < LIFTS[ side ] + ( distracted ? DISTRACTED : 0 );
	const watchful = Math.max( 0.05, ( WATCHFUL[ disposition ] ?? 0.5 ) - ( distracted ? DISTRACTED : 0 ) );
	const felt = chance( `${seed}|felt` );
	const noticed = side === 'front' || ( lifted ? felt < Math.max( watchful, SEEN[ side ] ?? 0 ) : felt < FUMBLE );
	return { lifted, noticed, side };

}

/** A stable number in [0, 1) from a string. */
function chance( seed ) {

	let hash = 2166136261;
	for ( const char of String( seed ) ) {

		hash ^= char.charCodeAt( 0 );
		hash = Math.imul( hash, 16777619 );

	}
	return ( hash >>> 0 ) / 4294967296;

}
