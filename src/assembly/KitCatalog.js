import { fnv1a } from './hash.js';

const QUARTER_TURNS = [ 'south', 'east', 'north', 'west' ];
const GRID = 1e-6;

/**
 * Groups parcels that want the same building into one kit and a placement each.
 *
 * Two parcels share a kit when their requests are equal once placement is
 * taken out of them: the lot becomes a rectangle at the origin with its street
 * side south, so position and rotation are the only things left that differ.
 * A parcel whose lot is not a rectangle, or that carries apertures of its own,
 * keeps a building of its own.
 */
export class KitCatalog {

	constructor( worldSeed ) {

		this.worldSeed = worldSeed;
		this.kits = new Map();
		this.placements = [];
		this.bespoke = [];

	}

	/**
	 * @param parcelId atlas parcel id
	 * @param request its BuildingRequest from RequestAssembler
	 * @returns the kit id it joined, or null when it keeps its own building
	 */
	add( parcelId, request ) {

		const frame = placementFrame( request );

		if ( ! frame ) {

			this.bespoke.push( parcelId );
			return null;

		}

		const normalized = this.#normalize( request, frame );
		const id = `k${fnv1a( JSON.stringify( normalized ) ).toString( 16 )}`;

		if ( ! this.kits.has( id ) ) this.kits.set( id, { ...normalized, seed: `${this.worldSeed}:kit:${id}`, buildingId: id } );
		this.placements.push( { parcelId, kit: id, position: frame.position, rotation: frame.rotation } );
		return id;

	}

	/** @returns every kit to build, in a stable order. */
	requests() { return [ ...this.kits.values() ].sort( ( a, b ) => a.buildingId.localeCompare( b.buildingId ) ); }

	/** @returns the placement table, one row per parcel that joined a kit. */
	table() { return [ ...this.placements ].sort( ( a, b ) => a.parcelId.localeCompare( b.parcelId, undefined, { numeric: true } ) ); }

	/** Moves the lot to the origin with its street side south and drops the parcel's identity. */
	#normalize( request, frame ) {

		const { width, depth } = frame;
		const footprint = [ [ 0, 0 ], [ width, 0 ], [ width, depth ], [ 0, depth ] ];
		const accessPoint = [ round( frame.access ), 0 ];

		return {
			...request,
			seed: null,
			buildingId: null,
			parcel: {
				...request.parcel,
				footprint,
				accessPoint,
				streetAccess: { edgeId: 'kit', path: [ [ 0, 0 ], [ width, 0 ] ] }
			}
		};

	}

}

/**
 * The lot's own frame when it can host a kit: an axis-aligned rectangle whose
 * street side becomes south, with the world position and rotation that put the
 * kit back where the parcel is.
 */
export function placementFrame( request ) {

	const { footprint, accessPoint } = request.parcel;

	if ( request.apertures?.length || footprint.length !== 4 ) return null;

	const xs = footprint.map( ( point ) => point[ 0 ] );
	const zs = footprint.map( ( point ) => point[ 1 ] );
	const min = [ Math.min( ...xs ), Math.min( ...zs ) ];
	const max = [ Math.max( ...xs ), Math.max( ...zs ) ];
	const corners = [ [ min[ 0 ], min[ 1 ] ], [ max[ 0 ], min[ 1 ] ], [ max[ 0 ], max[ 1 ] ], [ min[ 0 ], max[ 1 ] ] ];
	const ordered = [ ...footprint ].sort( compare );

	if ( [ ...corners ].sort( compare ).some( ( corner, index ) => ! same( corner, ordered[ index ] ) ) ) return null;

	const size = [ max[ 0 ] - min[ 0 ], max[ 1 ] - min[ 1 ] ];
	const turns = QUARTER_TURNS.indexOf( streetSide( accessPoint, min, max ) );

	if ( turns < 0 ) return null;

	const swapped = turns % 2 === 1;
	const width = swapped ? size[ 1 ] : size[ 0 ];
	const depth = swapped ? size[ 0 ] : size[ 1 ];
	const local = [ accessPoint[ 0 ] - min[ 0 ], accessPoint[ 1 ] - min[ 1 ] ];
	const access = [ local[ 0 ], local[ 1 ], size[ 0 ] - local[ 0 ], size[ 1 ] - local[ 1 ] ][ turns ];

	return { width, depth, access, rotation: turns * 90, lot: size, position: [ round( min[ 0 ] ), round( min[ 1 ] ) ] };

}

/**
 * A point of the kit's own frame in world coordinates. The kit is authored with
 * its street side south at the origin; `rotation` turns it back onto the lot and
 * `position` is the lot's minimum corner.
 */
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

/** Which side of the lot the access point sits on, or null when it sits on none. */
function streetSide( point, min, max ) {

	if ( Math.abs( point[ 1 ] - min[ 1 ] ) <= GRID ) return 'south';
	if ( Math.abs( point[ 0 ] - max[ 0 ] ) <= GRID ) return 'east';
	if ( Math.abs( point[ 1 ] - max[ 1 ] ) <= GRID ) return 'north';
	if ( Math.abs( point[ 0 ] - min[ 0 ] ) <= GRID ) return 'west';
	return null;

}

function compare( a, b ) { return a[ 0 ] - b[ 0 ] || a[ 1 ] - b[ 1 ]; }
function same( a, b ) { return Math.abs( a[ 0 ] - b[ 0 ] ) <= GRID && Math.abs( a[ 1 ] - b[ 1 ] ) <= GRID; }
function round( value ) { return Math.round( value * 1e6 ) / 1e6; }
