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

/** A stable number in [0, 1) from a string. */
function chance( seed ) {

	let hash = 2166136261;
	for ( const char of String( seed ) ) {

		hash ^= char.charCodeAt( 0 );
		hash = Math.imul( hash, 16777619 );

	}
	return ( hash >>> 0 ) / 4294967296;

}
