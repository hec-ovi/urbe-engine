import { fnv1a } from './hash.js';

const QUARTER_TURNS = [ 'south', 'east', 'north', 'west' ];
const GRID = 1e-6;
// The doorstep stands on the sidewalk, a curb and its gutter outside the lot.
const STOOP = 1.5;

/**
 * Groups parcels that want the same building into one kit and a placement each,
 * per the modular kit design (../../../docs/modular-kit.md).
 *
 * The lot Atlas publishes is the frame: a parcel's request is normalized into
 * its own lot with the street side south, so two parcels on the same standard
 * lot size wanting the same building share a kit and differ only by position
 * and rotation. A landmark, a lot off the standard catalog, or a parcel whose
 * own links carve its facade keeps a building of its own.
 */
export class KitCatalog {

	constructor( worldSeed ) {

		this.worldSeed = worldSeed;
		this.kits = new Map();
		this.placements = [];
		this.bespoke = [];

	}

	/**
	 * @param parcel the atlas parcel, for its lot, lotSize and landmark flag
	 * @param request its BuildingRequest from RequestAssembler
	 * @returns the kit id it joined, or null when it keeps its own building
	 */
	add( parcel, request ) {

		const frame = placementFrame( parcel, request );

		if ( ! frame ) {

			this.bespoke.push( parcel.id );
			return null;

		}

		const normalized = normalize( request, frame );
		const id = `k${fnv1a( JSON.stringify( normalized ) ).toString( 16 )}`;

		if ( ! this.kits.has( id ) ) this.kits.set( id, { ...normalized, seed: `${this.worldSeed}:kit:${id}`, buildingId: id } );
		this.placements.push( { parcelId: parcel.id, kit: id, lotSize: parcel.lotSize, position: frame.position, rotation: frame.rotation } );
		return id;

	}

	/** @returns every kit to build, in a stable order. */
	requests() { return [ ...this.kits.values() ].sort( ( a, b ) => a.buildingId.localeCompare( b.buildingId ) ); }

	/** @returns the placement table, one row per parcel that joined a kit. */
	table() { return [ ...this.placements ].sort( ( a, b ) => a.parcelId.localeCompare( b.parcelId, undefined, { numeric: true } ) ); }

}

/**
 * The lot's own frame when it can host a kit: the standard lot rectangle turned
 * so its street side is south, with the world position and rotation that put
 * the kit back where the parcel is. Null when this parcel needs its own
 * building: a landmark, a lot off the standard catalog or not a rectangle, an
 * access point that misses its lot, or links that carve this facade alone.
 */
export function placementFrame( parcel, request ) {

	if ( parcel.landmark || ! parcel.lotSize || request.apertures?.length ) return null;

	const lot = rectangle( parcel.lot );

	if ( ! lot ) return null;

	const turns = QUARTER_TURNS.indexOf( streetSide( request.parcel.accessPoint, lot.min, lot.max ) );

	if ( turns < 0 ) return null;

	const swapped = turns % 2 === 1;

	return {
		lot: lot.size,
		width: swapped ? lot.size[ 1 ] : lot.size[ 0 ],
		depth: swapped ? lot.size[ 0 ] : lot.size[ 1 ],
		rotation: turns * 90,
		position: lot.min.map( round )
	};

}

/** A point of the kit's own frame in world coordinates. */
export function kitToWorld( { rotation, lot, position }, [ u, v ] ) {

	const [ width, depth ] = lot;
	const local = [
		[ u, v ],
		[ width - v, u ],
		[ width - u, depth - v ],
		[ v, depth - u ]
	][ rotation / 90 ];

	return [ round( position[ 0 ] + local[ 0 ] ), round( position[ 1 ] + local[ 1 ] ) ];

}

/** The same request expressed in the kit's own frame, with the parcel's identity gone. */
function normalize( request, frame ) {

	const toKit = ( point ) => worldToKit( frame, point );

	return {
		...request,
		seed: null,
		buildingId: null,
		parcel: {
			...request.parcel,
			lot: [ [ 0, 0 ], [ frame.width, 0 ], [ frame.width, frame.depth ], [ 0, frame.depth ] ],
			footprint: canonicalRing( request.parcel.footprint.map( toKit ) ),
			accessPoint: toKit( request.parcel.accessPoint ),
			streetAccess: { edgeId: 'kit', path: [ [ 0, 0 ], [ frame.width, 0 ] ] }
		}
	};

}

/** The inverse of kitToWorld: a world point in the kit's own frame. */
export function worldToKit( { rotation, lot, position }, point ) {

	const [ width, depth ] = lot;
	const u = point[ 0 ] - position[ 0 ];
	const v = point[ 1 ] - position[ 1 ];
	const local = [
		[ u, v ],
		[ v, width - u ],
		[ width - u, depth - v ],
		[ depth - v, u ]
	][ rotation / 90 ];

	return [ round( local[ 0 ] ), round( local[ 1 ] ) ];

}

/** The same ring started at its lowest corner, so a turned lot hashes as itself. */
function canonicalRing( ring ) {

	let start = 0;
	for ( let index = 1; index < ring.length; index ++ ) if ( compare( ring[ index ], ring[ start ] ) < 0 ) start = index;
	return ring.map( ( _, index ) => ring[ ( start + index ) % ring.length ] );

}

/** The axis-aligned rectangle a polygon describes, or null when it describes none. */
function rectangle( polygon ) {

	if ( ! Array.isArray( polygon ) || polygon.length !== 4 ) return null;

	const xs = polygon.map( ( point ) => point[ 0 ] );
	const zs = polygon.map( ( point ) => point[ 1 ] );
	const min = [ Math.min( ...xs ), Math.min( ...zs ) ];
	const max = [ Math.max( ...xs ), Math.max( ...zs ) ];
	const corners = [ [ min[ 0 ], min[ 1 ] ], [ max[ 0 ], min[ 1 ] ], [ max[ 0 ], max[ 1 ] ], [ min[ 0 ], max[ 1 ] ] ];
	const ordered = [ ...polygon ].sort( compare );

	if ( [ ...corners ].sort( compare ).some( ( corner, index ) => ! same( corner, ordered[ index ] ) ) ) return null;

	return { min, max, size: [ max[ 0 ] - min[ 0 ], max[ 1 ] - min[ 1 ] ] };

}

/**
 * Which side of the lot the parcel is entered from, or null when the access
 * point belongs to no side of it. The point is the doorstep on the sidewalk, so
 * it sits a curb and gutter outside its own lot; anything within STOOP of one
 * side, and along that side's run, names it.
 */
function streetSide( point, min, max ) {

	const sides = [
		{ side: 'south', distance: Math.abs( point[ 1 ] - min[ 1 ] ), along: point[ 0 ], span: [ min[ 0 ], max[ 0 ] ] },
		{ side: 'east', distance: Math.abs( point[ 0 ] - max[ 0 ] ), along: point[ 1 ], span: [ min[ 1 ], max[ 1 ] ] },
		{ side: 'north', distance: Math.abs( point[ 1 ] - max[ 1 ] ), along: point[ 0 ], span: [ min[ 0 ], max[ 0 ] ] },
		{ side: 'west', distance: Math.abs( point[ 0 ] - min[ 0 ] ), along: point[ 1 ], span: [ min[ 1 ], max[ 1 ] ] }
	].filter( ( side ) => side.along >= side.span[ 0 ] - STOOP && side.along <= side.span[ 1 ] + STOOP )
		.sort( ( a, b ) => a.distance - b.distance );

	return sides.length && sides[ 0 ].distance <= STOOP ? sides[ 0 ].side : null;

}

function compare( a, b ) { return a[ 0 ] - b[ 0 ] || a[ 1 ] - b[ 1 ]; }
function same( a, b ) { return Math.abs( a[ 0 ] - b[ 0 ] ) <= GRID && Math.abs( a[ 1 ] - b[ 1 ] ) <= GRID; }
function round( value ) { return Math.round( value * 1e6 ) / 1e6; }
