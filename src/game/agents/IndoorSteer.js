/** A person's radius indoors, metres: two people keep twice this apart. */
export const INDOOR_RADIUS = 0.34;
/** How far ahead a walker looks for somebody in its way, metres. */
const LOOK = 3.5;
/** The furthest a walker steps off its line to pass somebody, metres. */
const REACH = 0.9;
/** How fast a walker steps aside and back, metres a second. */
const STEP_ASIDE = 1.2;
/** How near somebody it cannot pass a walker comes before it stops for them, metres ahead. */
const HOLD_AT = 1.4;
/** Nearer than this, a walker giving way steps back out of the other's way, metres. */
const BACK_AT = 0.9;
/** How fast a walker giving way steps back, metres a second. */
const BACK_PACE = 0.6;
/** Seconds a walker waits for somebody before it goes on anyway, and how long it then goes before waiting again. */
const PATIENCE = 4;
const RESOLVE = 2;
/** How far on a walker standing aside looks to see whether the floor still holds it there, metres. */
const AHEAD = 0.3;
/** How far behind somebody going the same way a walker keeps, beyond touching, metres. */
const FOLLOW = 0.15;
/** Two bodies further apart in height than this stand on different floors. */
const FLOOR = 1.5;
const CLEAR = 1e-3;

/**
 * Keeps people inside buildings out of each other and out of the player.
 *
 * Indoors there is no pavement to spread over, so each frame every walker
 * looks LOOK ahead along its way: somebody in its line makes it step across
 * to the nearest line that passes everybody there, keeping to its own right
 * when they come the other way, as far as the building's walkable floor
 * allows (REACH at most); nobody near and it eases back onto its line. Where
 * the floor leaves no line that passes (a door, a narrow corridor, a lift's
 * doorway), the walker of the lower priority stops short of the other and,
 * if the other still comes on, steps back out of its way, until it is through;
 * a walker never gives way to one that gives way to it, and one kept waiting
 * PATIENCE seconds goes on anyway for RESOLVE seconds, so nobody waits for
 * ever. Somebody standing, and the player, never move for a walker: it passes
 * them or waits for them.
 *
 * Offsets are positive to a walker's left, as the crowd's lanes are.
 */
export class IndoorSteer {

	/**
	 * @param walkable `( parcelId, [ x, y, z ] ) => boolean`, whether a person's middle may stand there inside that
	 *   building (Interior's navigation cells already keep a body's radius off its walls)
	 */
	constructor( { walkable = () => true } = {} ) {

		this.walkable = walkable;
		/** id to `{ offset, hold, waited, going, cap }`, what each walker last did and may walk. */
		this.state = new Map();

	}

	/**
	 * One frame for everybody indoors near the player.
	 *
	 * @param bodies `[{ id, parcelId, position: [x, y, z], heading, moving, priority }]`: `position` where the
	 *   body's own walk puts it (its line), `heading` the way it walks, `moving` whether it walks now, `priority`
	 *   a number, higher going first (ties go to the lower id)
	 * @param player the player's feet `[x, y, z]`, or null
	 * @param delta seconds since the last frame
	 */
	update( bodies, player, delta ) {

		const seen = new Set();
		const drawn = new Map( bodies.map( ( body ) => [ body.id, this.#at( body ) ] ) );
		for ( const body of bodies ) {

			seen.add( body.id );
			const state = this.#state( body.id );
			state.cap = Infinity;
			if ( ! body.moving ) {

				state.offset = stepToward( state.offset, 0, STEP_ASIDE * delta );
				state.hold = false;
				state.waited = 0;
				continue;

			}
			const ahead = this.#inLine( body, bodies, drawn, player );
			const first = firstOf( state.offset, ahead );
			if ( ! first ) {

				// Back onto its line, but not into somebody still alongside.
				const back = stepToward( state.offset, this.#room( body, 0 ), STEP_ASIDE * delta );
				if ( ahead.every( ( other ) => Math.abs( back - other.line ) >= other.space - CLEAR || Math.abs( state.offset - other.line ) < other.space - CLEAR ) ) state.offset = back;
				state.hold = false;
				state.waited = 0;
				if ( ! this.#stands( body, state.offset, AHEAD ) ) state.cap = 0;
				continue;

			}
			if ( first.same ) {

				// Close behind somebody going the same way, a walker keeps its distance.
				state.hold = false;
				state.waited = 0;
				if ( first.ahead < first.space + FOLLOW ) state.cap = 0;
				continue;

			}
			const target = this.#aside( body, state.offset, ahead, first );
			if ( target !== null ) state.offset = stepToward( state.offset, target, STEP_ASIDE * delta );
			const passes = Math.abs( state.offset - first.line ) >= first.space - CLEAR;
			const yields = ! passes && first.ahead <= HOLD_AT && this.#givesWay( body, first );
			state.going = Math.max( 0, state.going - delta );
			// Stepping back out of the way is getting somewhere; only standing still wears out patience.
			const backing = first.coming && first.ahead < BACK_AT;
			if ( yields && state.going === 0 && ! backing ) {

				state.waited += delta;
				if ( state.waited > PATIENCE ) {

					state.waited = 0;
					state.going = RESOLVE;

				}

			} else if ( ! yields || backing ) state.waited = 0;
			state.hold = yields && state.going === 0;
			if ( state.hold ) {

				// Still coming on at arm's length: the one giving way steps back out of its way.
				state.cap = first.coming && first.ahead < BACK_AT ? - BACK_PACE * delta : 0;

			} else if ( ! passes && first.yields && first.ahead < BACK_AT * 1.5 ) {

				// Behind somebody stepping back out of its way, a walker comes on no faster than they go.
				state.cap = BACK_PACE * delta;

			}
			// Stepped aside into a wider spot, a walker waits there until it can walk on where the floor narrows.
			if ( state.cap > 0 && ! this.#stands( body, state.offset, AHEAD ) ) state.cap = 0;

		}
		for ( const id of this.state.keys() ) if ( ! seen.has( id ) ) this.state.delete( id );

	}

	/** Metres to the walker's left it stands off its line now. */
	offset( id ) {

		return this.state.get( id )?.offset ?? 0;

	}

	/** Whether the walker waits this frame for somebody it cannot pass. */
	holds( id ) {

		return this.state.get( id )?.hold ?? false;

	}

	/**
	 * How far a walker that would walk `wanted` metres this frame may walk on: all of it when nobody is in its
	 * way, 0 while it waits, less behind somebody stepping back for it, and a negative distance, back along its
	 * way, while it steps back out of somebody's way.
	 */
	travel( id, wanted ) {

		const cap = this.state.get( id )?.cap ?? Infinity;
		return cap < 0 ? cap : Math.min( wanted, cap );

	}

	/** Where a body is drawn: its line moved by its offset to its left. */
	#at( body ) {

		const offset = this.offset( body.id );
		return [ body.position[ 0 ] + Math.cos( body.heading ) * offset, body.position[ 1 ], body.position[ 2 ] - Math.sin( body.heading ) * offset ];

	}

	#state( id ) {

		let state = this.state.get( id );
		if ( ! state ) this.state.set( id, state = { offset: 0, hold: false, waited: 0, going: 0, cap: Infinity } );
		return state;

	}

	/**
	 * Everybody beside a walker or ahead of it within LOOK on its floor: `{ ahead, line, space, coming, id,
	 * priority, moving, yields }`, `line` how far to the walker's left of its line they stand and `coming`
	 * whether they walk towards it. Somebody walking the same way is in the way only when they are slower.
	 */
	#inLine( body, bodies, drawn, player ) {

		const found = [];
		const forward = [ Math.sin( body.heading ), Math.cos( body.heading ) ];
		const across = [ Math.cos( body.heading ), - Math.sin( body.heading ) ];
		const [ x, y, z ] = body.position;
		const look = ( at, space, extra ) => {

			if ( Math.abs( at[ 1 ] - y ) > FLOOR ) return;
			const dx = at[ 0 ] - x, dz = at[ 2 ] - z;
			const along = dx * forward[ 0 ] + dz * forward[ 1 ];
			if ( along <= - space || along > LOOK ) return;
			const line = dx * across[ 0 ] + dz * across[ 1 ];
			if ( Math.abs( line ) >= REACH + space ) return;
			found.push( { ahead: along, line, space, ...extra } );

		};
		for ( const other of bodies ) {

			if ( other.id === body.id ) continue;
			const facing = Math.cos( other.heading - body.heading );
			// Somebody walking ahead the same way is followed, not passed, unless they stop.
			const same = other.moving && facing > 0.5 && ! this.holds( other.id );
			look( drawn.get( other.id ), INDOOR_RADIUS * 2, {
				id: other.id, priority: other.priority, moving: other.moving && ! this.holds( other.id ), coming: other.moving && facing < 0,
				yields: this.holds( other.id ), same
			} );

		}
		if ( player ) look( player, INDOOR_RADIUS * 2, { id: null, priority: Infinity, moving: false, coming: false, yields: false, same: false } );
		return found;

	}

	/**
	 * The offset that passes everybody in line: of the lines just clear of each of them that the floor holds, the
	 * walker's own right-most when the first comes the other way, else the nearest; null when none passes.
	 */
	#aside( body, current, ahead, first ) {

		const clears = ( offset ) => ahead.every( ( other ) => Math.abs( offset - other.line ) >= other.space - CLEAR );
		let target = null;
		for ( const other of ahead ) for ( const side of [ other.line - other.space, other.line + other.space ] ) {

			if ( Math.abs( side ) > REACH || ! clears( side ) || ! this.#stands( body, side ) ) continue;
			const better = target === null || ( first.coming
				? side < target
				: Math.abs( side - current ) < Math.abs( target - current ) - 1e-6 );
			if ( better ) target = side;

		}
		return target;

	}

	/** The offset nearest `wanted` the floor holds, back towards the line. */
	#room( body, wanted ) {

		return this.#stands( body, wanted ) ? wanted : 0;

	}

	/**
	 * Whether a body standing `offset` to the left of its line, `forward` metres on along its way, stands on
	 * walkable floor: its middle on a cell where a body may stand, which keeps its radius off the walls.
	 */
	#stands( body, offset, forward = 0 ) {

		if ( Math.abs( offset ) < 1e-6 ) return true;
		const c = Math.cos( body.heading ), s = Math.sin( body.heading );
		const [ x, y, z ] = [ body.position[ 0 ] + s * forward, body.position[ 1 ], body.position[ 2 ] + c * forward ];
		return this.walkable( body.parcelId, [ x + c * offset, y, z - s * offset ] );

	}

	/**
	 * Whether a walker waits for `other`: always for somebody standing or the player; for another walker only
	 * when that one goes first, by priority and then by the lower id, and never for one already waiting for it.
	 */
	#givesWay( body, other ) {

		if ( ! other.moving ) return ! other.yields;
		if ( other.yields ) return false;
		if ( other.priority !== body.priority ) return other.priority > body.priority;
		return String( other.id ) < String( body.id );

	}

}

/** The nearest of `ahead` standing in the walker's line at `offset`, or null. */
function firstOf( offset, ahead ) {

	let first = null;
	for ( const other of ahead ) {

		if ( other.ahead > 0 && Math.abs( offset - other.line ) < other.space - CLEAR && ( ! first || other.ahead < first.ahead ) ) first = other;

	}
	return first;

}

function stepToward( from, to, step ) {

	return from + Math.max( - step, Math.min( step, to - from ) );

}
