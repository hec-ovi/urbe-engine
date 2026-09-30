import { CLIP } from './CharacterAssets.js';
import { FRAMES } from './VatBaker.js';

/** How fast a guest walks inside, metres a second. */
const PACE = 1.05;
/** Seconds a guest sits before getting up for a while, and stands at the counter or by the door before sitting again. */
export const STAY = Object.freeze( [ 60, 240 ] );
export const BREAK = Object.freeze( [ 15, 45 ] );
/** How far before the end of the walk out a leaving guest starts to fade, metres: about the doorway. */
const FADE_OUT = 1.1;
/** How far in front of the person serving at a counter a guest stands to be served, metres. */
const COUNTER_REACH = 1.35;
/** The share of sitting down in which the body turns from where it walked to face the seat's way. */
const TURN = 0.35;

/**
 * A guest's visit inside a venue, as the crowd draws it: they sit a while
 * (STAY, their seed's), get up with the library's stand-up clip, go and stand
 * at the counter or by the door (BREAK), and sit down again with its sit-down
 * clip on the first free seat, perhaps another one, so a seat is taken by
 * somebody else now and then. When the simulation's visit ends they stand up
 * and walk out through the door, fading as they reach it; a guest arriving
 * where the player can see the seat walks in from the door and sits down.
 * Walks inside a building follow the interior routes where they cover it,
 * else a straight line. What a guest does is on `member.visit`; while they
 * sit or stand still, their role's idle variety moves them (IdleVariety).
 */
export class Visits {

	/**
	 * @param durations each baked clip's length in seconds
	 * @param routes InteriorRoutes, `{ covers, route( parcelId, from, to ) }`, or null
	 * @param spots the spots taken at a parcel now: `spots( parcelId )` is a Set of `kind:index`
	 */
	constructor( { durations, routes = null, spots } ) {

		this.durations = durations;
		this.routes = routes;
		this.spots = spots;

	}

	/**
	 * Starts a guest's visit on `anchor`, a seat of `place` (Crowd's anchor:
	 * its spot, position and heading): sitting there, or walking in from the
	 * door to it when `arriving`.
	 */
	seat( member, anchor, place, { arriving = false } = {} ) {

		const seat = seatOf( anchor, place );
		member.visit = {
			stage: 'seated', next: null, leaving: false, round: 0, timer: 0, seat,
			path: null, lengths: null, at: 0, fromY: 0, toY: 0, fromHeading: 0
		};
		if ( ! arriving ) {

			member.clip = CLIP.SIT;
			member.visit.timer = this.#stay( member, STAY );
			return;

		}
		member.position.set( place.inside.x, place.inside.y, place.inside.z );
		this.#walk( member, place, this.#route( member, place, seat.stand ), 'sit' );

	}

	/** The simulation's visit is over: the guest gets up where they sit, or turns from wherever they are, and walks out. */
	leave( member, place ) {

		const visit = member.visit;
		if ( ! visit || visit.leaving ) return;
		visit.leaving = true;
		member.retiring = true;
		member.crowdId = null;
		if ( ! member.npcId ) member.instance = null;
		if ( visit.stage === 'seated' ) this.#rise( member, 'leave' );
		else if ( visit.stage === 'rising' ) visit.next = 'leave';
		else if ( visit.stage === 'waiting' || visit.stage === 'walking' ) this.#out( member, place );

	}

	/**
	 * Moves a guest on by `delta` seconds. True when the visit drove the body
	 * this frame (getting up, walking, sitting down); false while they sit or
	 * stand still, which the idle variety moves.
	 */
	step( member, delta, place ) {

		const visit = member.visit;
		if ( ! visit ) return false;
		// Somebody the player talks to, or the story or the schedule controls, is theirs now.
		if ( member.frozen && ! visit.leaving ) {

			member.visit = null;
			return false;

		}
		switch ( visit.stage ) {

			case 'seated':
				visit.timer -= delta;
				if ( ( ! visit.leaving && visit.timer > 0 ) || ! resting( member ) ) return false;
				this.#rise( member, visit.leaving ? 'leave' : 'wait' );
				return true;
			case 'waiting':
				visit.timer -= delta;
				if ( visit.timer > 0 || ! resting( member ) || ! place ) return false;
				this.#back( member, place );
				return member.visit.stage !== 'waiting';
			case 'rising':
				return this.#rising( member, delta, place );
			case 'walking':
				return this.#walking( member, delta, place );
			case 'sitting':
				return this.#sitting( member, delta );
			default:
				return false;

		}

	}

	/** Gets up from the seat: the stand-up clip, the feet lowered to the floor as it plays. */
	#rise( member, next ) {

		const visit = member.visit;
		visit.stage = 'rising';
		visit.next = next;
		visit.fromY = member.position.y;
		visit.toY = visit.seat.floor;
		member.clip = CLIP.IDLE;
		member.shown = CLIP.STAND_UP;
		member.frame = 0;

	}

	#rising( member, delta, place ) {

		const visit = member.visit;
		member.shown = CLIP.STAND_UP;
		member.frame += ( delta / ( this.durations[ CLIP.STAND_UP ] || 1 ) ) * FRAMES;
		const t = Math.min( 1, member.frame / FRAMES );
		member.position.y = visit.fromY + ( visit.toY - visit.fromY ) * t;
		if ( t < 1 ) return true;
		member.frame = 0;
		member.shown = CLIP.IDLE;
		if ( ! place ) return true;
		if ( visit.next === 'leave' ) this.#out( member, place );
		else this.#aside( member, place );
		return true;

	}

	/** Up for a while: to the counter to be served, else to a free spot by the door, leaving the seat to whoever comes. */
	#aside( member, place ) {

		const taken = this.spots( member.parcelId );
		taken.delete( member.spot );
		const spot = breakSpot( place, taken );
		if ( ! spot ) {

			// Nowhere to stand: sit on.
			member.visit.stage = 'sitting';
			member.visit.fromHeading = member.heading;
			member.visit.fromY = member.position.y;
			member.visit.toY = member.visit.seat.position.y;
			member.shown = CLIP.SIT_DOWN;
			member.frame = 0;
			return;

		}
		member.spot = spot.spot;
		member.visit.aside = spot;
		this.#walk( member, place, this.#route( member, place, spot.position.toArray() ), 'wait' );

	}

	/** Back to a seat after standing a while: the first one free, their own if nobody took it. */
	#back( member, place ) {

		const taken = this.spots( member.parcelId );
		taken.delete( member.spot );
		const own = member.visit.seat;
		const anchor = taken.has( own.spot ) ? freeSeat( place, taken ) : { spot: own.spot, position: own.position, heading: own.heading };
		if ( ! anchor ) {

			member.visit.timer = this.#stay( member, BREAK );
			return;

		}
		member.visit.seat = seatOf( anchor, place );
		member.spot = anchor.spot;
		this.#walk( member, place, this.#route( member, place, member.visit.seat.stand ), 'sit' );

	}

	/** Out through the door: to just inside it, then on through it, fading as they reach it. */
	#out( member, place ) {

		const path = this.#route( member, place, place.inside.toArray() );
		if ( place.outside ) path.push( place.outside.toArray() );
		member.spot = null;
		this.#walk( member, place, path, 'leave' );

	}

	/** A walk inside the building from where the guest stands: the interior routes' where they cover it, else straight. */
	#route( member, place, to ) {

		const from = member.position.toArray();
		const found = this.routes?.covers( member.parcelId ) ? this.routes.route( member.parcelId, from, to )?.path3 : null;
		return found?.length > 1 ? found.map( ( point ) => [ ...point ] ) : [ from, to ];

	}

	#walk( member, place, path, next ) {

		const visit = member.visit;
		const lengths = new Float64Array( path.length );
		for ( let i = 1; i < path.length; i ++ ) {

			lengths[ i ] = lengths[ i - 1 ] + Math.hypot( path[ i ][ 0 ] - path[ i - 1 ][ 0 ], path[ i ][ 2 ] - path[ i - 1 ][ 2 ] );

		}
		visit.stage = 'walking';
		visit.next = next;
		visit.path = path;
		visit.lengths = lengths;
		visit.at = 0;
		member.clip = CLIP.WALK;
		member.shown = CLIP.WALK;

	}

	#walking( member, delta, place ) {

		const visit = member.visit;
		const total = visit.lengths[ visit.lengths.length - 1 ];
		visit.at = Math.min( total, visit.at + PACE * delta );
		along( member, visit.path, visit.lengths, visit.at );
		member.shown = CLIP.WALK;
		member.frame = ( member.frame + ( delta / ( this.durations[ CLIP.WALK ] || 1 ) ) * FRAMES ) % FRAMES;
		if ( visit.leaving ) {

			if ( total - visit.at <= FADE_OUT ) member.leaving = true;
			return true;

		}
		if ( visit.at < total ) return true;
		if ( visit.next === 'sit' ) {

			visit.stage = 'sitting';
			visit.fromHeading = member.heading;
			visit.fromY = member.position.y;
			visit.toY = visit.seat.position.y;
			member.clip = CLIP.IDLE;
			member.shown = CLIP.SIT_DOWN;
			member.frame = 0;
			return true;

		}
		// Standing a while where they went: facing the counter, or into the room.
		visit.stage = 'waiting';
		visit.timer = this.#stay( member, BREAK );
		member.clip = CLIP.IDLE;
		member.shown = CLIP.IDLE;
		member.heading = visit.aside?.heading ?? member.heading;
		return false;

	}

	#sitting( member, delta ) {

		const visit = member.visit;
		const seat = visit.seat;
		member.shown = CLIP.SIT_DOWN;
		member.frame += ( delta / ( this.durations[ CLIP.SIT_DOWN ] || 1 ) ) * FRAMES;
		const t = Math.min( 1, member.frame / FRAMES );
		member.position.x = seat.position.x;
		member.position.z = seat.position.z;
		member.position.y = visit.fromY + ( visit.toY - visit.fromY ) * t;
		member.heading = turnTowards( visit.fromHeading, seat.heading, Math.min( 1, t / TURN ) );
		if ( t < 1 ) return true;
		member.clip = CLIP.SIT;
		member.shown = CLIP.SIT;
		member.frame = 0;
		member.heading = seat.heading;
		visit.stage = 'seated';
		visit.aside = null;
		visit.timer = this.#stay( member, STAY );
		return true;

	}

	/** How long this stage of a guest's visit lasts: their seed's, and another each time round. */
	#stay( member, [ least, most ] ) {

		const visit = member.visit;
		visit.round ++;
		return least + ( most - least ) * unit( member.appearanceSeed ?? 0, visit.round );

	}

}

/** Whether a resting guest is between fidgets, so getting up starts from the pose the loop comes round to. */
function resting( member ) {

	return ! member.idle || member.shown === member.idle.style.base;

}

/** Where a guest sits: the seat's root and way, the floor under it and where they stand to sit down or after getting up. */
function seatOf( anchor, place ) {

	const floor = place.inside.y;
	return {
		spot: anchor.spot,
		position: anchor.position.clone(),
		heading: anchor.heading,
		floor,
		stand: [ anchor.position.x, floor, anchor.position.z ]
	};

}

/** The first seat of a place nobody holds, as the crowd picks one (Crowd's anchors), or null. */
export function freeSeat( place, taken ) {

	const seats = ( place.anchors?.seat ?? [] ).filter( ( anchor ) => ! place.contains || place.contains( anchor.position ) );
	for ( let index = 0; index < seats.length; index ++ ) {

		if ( ! taken.has( `seat:${index}` ) ) return { spot: `seat:${index}`, position: seats[ index ].position, heading: seats[ index ].heading };

	}
	return null;

}

/** Somewhere a guest stands a while: in front of a counter nobody waits at, else a free spot by the door. */
export function breakSpot( place, taken ) {

	const counters = ( place.anchors?.counter ?? [] ).filter( ( anchor ) => ! place.contains || place.contains( anchor.position ) );
	for ( let index = 0; index < counters.length; index ++ ) {

		if ( taken.has( `queue:${index}` ) ) continue;
		const counter = counters[ index ];
		const position = counter.position.clone();
		position.x += Math.sin( counter.heading ) * COUNTER_REACH;
		position.z += Math.cos( counter.heading ) * COUNTER_REACH;
		position.y = place.inside.y;
		if ( place.contains && ! place.contains( position ) ) continue;
		return { spot: `queue:${index}`, position, heading: counter.heading + Math.PI };

	}
	for ( let index = 0; index < ( place.lobby?.length ?? 0 ); index ++ ) {

		if ( taken.has( `lobby:${index}` ) ) continue;
		return { spot: `lobby:${index}`, position: place.lobby[ index ].clone(), heading: place.heading + Math.PI };

	}
	return null;

}

/** Stands a walker `at` metres along a path, facing along it. */
function along( member, path, lengths, at ) {

	let i = 1;
	while ( i < lengths.length - 1 && lengths[ i ] < at ) i ++;
	const a = path[ i - 1 ];
	const b = path[ i ];
	const span = lengths[ i ] - lengths[ i - 1 ];
	const t = span > 1e-6 ? Math.min( 1, Math.max( 0, ( at - lengths[ i - 1 ] ) / span ) ) : 1;
	member.position.set( a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * t, a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t, a[ 2 ] + ( b[ 2 ] - a[ 2 ] ) * t );
	if ( span > 1e-6 ) member.heading = Math.atan2( b[ 0 ] - a[ 0 ], b[ 2 ] - a[ 2 ] );

}

/** The heading `t` of the short way round from one to another. */
function turnTowards( from, to, t ) {

	const turn = Math.atan2( Math.sin( to - from ), Math.cos( to - from ) );
	return from + turn * t;

}

/** A number in [0, 1) that the seed and round alone decide. */
function unit( seed, round ) {

	let h = ( ( seed >>> 0 ) ^ Math.imul( round + 1, 0x9e3779b9 ) ) >>> 0;
	h = Math.imul( h ^ ( h >>> 16 ), 0x85ebca6b );
	h = Math.imul( h ^ ( h >>> 13 ), 0xc2b2ae35 );
	return ( ( h ^ ( h >>> 16 ) ) >>> 0 ) / 4294967296;

}
