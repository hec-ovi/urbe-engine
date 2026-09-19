import * as THREE from 'three/webgpu';
import { buildingFloors } from './InteriorLayouts.js';

/**
 * The storey plates of a building that opens an interior.
 *
 * Exterior publishes one two-sided plate per floor, `floor:<index>/slab`, over
 * the whole outline, and Interior draws its own module floors over the room
 * envelope, leaving the band between that rectangle and the outline to the
 * exterior plate. Where both stand the two surfaces are coplanar to the
 * millimetre, which is what makes a furnished floor flicker, and the plate
 * also runs straight across the stair and lift wells the module floors carry
 * cutouts for.
 *
 * So a plate is cut apart at the envelope: the band is the plate's, the
 * envelope and the wells inside it are the module floors', and a building that
 * opens no interior keeps its plates whole.
 *
 * Everything here works in one frame, the frame the plate's own geometry is
 * in: world metres for a shell, the plan's lot frame for a kit copy.
 */

/** A vertex nearer than this to a cut edge is on it, not across it. */
const EPSILON = 1e-4;
/** What a plate is called, before and after GLTFLoader strips `:` and `/` from node names. */
const PLATE = /^floor:?(-?\d+)\/?slab$/;
const ATTRIBUTES = [ 'position', 'normal', 'uv' ];

/** Which storey this node is the plate of, or null when it is not one. */
export function storeyIndex( node ) {

	const match = PLATE.exec( node.name ?? '' );

	return match ? Number( match[ 1 ] ) : null;

}

/**
 * What the interior of this building covers, floor by floor: the rectangle its
 * rooms and its vertical core stand in, at the elevation it stands at. A floor
 * the interior does not publish is absent, and its plate stays whole.
 *
 * @param interior `{ building, layouts }` as BuildingSource reads them
 * @returns Map<floorIndex, { elevation, rect: { x0, z0, x1, z1 } }>
 */
export function interiorStoreys( parcelId, interior ) {

	const storeys = new Map();

	if ( ! interior?.building?.floors?.length ) return storeys;

	for ( const floor of buildingFloors( parcelId, interior ) ) {

		const rect = envelopeOf( floor );

		if ( rect ) storeys.set( floor.floor, { elevation: floor.elevation, rect } );

	}

	return storeys;

}

/** The rectangle one floor's rooms and core occupy, or null when it publishes neither. */
function envelopeOf( floor ) {

	const rect = { x0: Infinity, z0: Infinity, x1: - Infinity, z1: - Infinity };

	for ( const room of floor.rooms ?? [] ) {

		for ( const [ x, z ] of room.polygon ?? [] ) grow( rect, x, z );

	}
	// The core is inside the rooms on every plan seen, and including it is what
	// guarantees the stair and the lift are open whatever a plan does.
	for ( const one of coreRects( floor.core ) ) {

		grow( rect, one.x, one.z );
		grow( rect, one.x + one.w, one.z + one.d );

	}

	return rect.x1 - rect.x0 > EPSILON && rect.z1 - rect.z0 > EPSILON ? rect : null;

}

function* coreRects( core ) {

	for ( const list of [ core?.stairs, core?.elevators, core?.shafts ] ) {

		for ( const one of list ?? [] ) {

			const rect = one.rect ?? one;
			if ( Number.isFinite( rect?.x ) && rect.w > 0 && rect.d > 0 ) yield rect;

		}

	}

}

function grow( rect, x, z ) {

	rect.x0 = Math.min( rect.x0, x );
	rect.z0 = Math.min( rect.z0, z );
	rect.x1 = Math.max( rect.x1, x );
	rect.z1 = Math.max( rect.z1, z );

}

/**
 * The part of a plate that falls outside a rectangle, cut exactly at its
 * edges.
 *
 * The outside of a rectangle is four convex regions (the two sides, then the
 * two ends between them), so each triangle is clipped against each of them and
 * the pieces are fanned back into triangles. A vertex of a piece is carried as
 * the weights of the triangle it came from, so every attribute the plate wears
 * interpolates the same way its position does.
 *
 * @param geometry a baked plate: non-indexed, position, normal and uv
 * @param rect the envelope, in the same frame as the geometry
 * @returns the band, or null when the envelope covers the whole plate
 */
export function cutPlate( geometry, rect ) {

	const sources = ATTRIBUTES.map( ( name ) => geometry.getAttribute( name ) ).filter( Boolean );
	const position = geometry.getAttribute( 'position' );
	const written = sources.map( () => [] );
	const x = [ 0, 0, 0 ];
	const z = [ 0, 0, 0 ];

	for ( let start = 0; start + 2 < position.count; start += 3 ) {

		for ( let corner = 0; corner < 3; corner ++ ) {

			x[ corner ] = position.getX( start + corner );
			z[ corner ] = position.getZ( start + corner );

		}

		const low = [ Math.min( ...x ), Math.min( ...z ) ];
		const high = [ Math.max( ...x ), Math.max( ...z ) ];

		// Clear of the envelope: the whole triangle is band.
		if ( high[ 0 ] <= rect.x0 + EPSILON || low[ 0 ] >= rect.x1 - EPSILON
			|| high[ 1 ] <= rect.z0 + EPSILON || low[ 1 ] >= rect.z1 - EPSILON ) {

			for ( let corner = 0; corner < 3; corner ++ ) copy( sources, written, start + corner );
			continue;

		}
		// Inside it: the module floors draw this.
		if ( low[ 0 ] >= rect.x0 - EPSILON && high[ 0 ] <= rect.x1 + EPSILON
			&& low[ 1 ] >= rect.z0 - EPSILON && high[ 1 ] <= rect.z1 + EPSILON ) continue;

		for ( const region of regions( rect ) ) {

			const piece = clipped( region, x, z );

			for ( let corner = 1; corner + 1 < piece.length; corner ++ ) {

				const fan = [ piece[ 0 ], piece[ corner ], piece[ corner + 1 ] ];
				if ( area( fan, x, z ) <= EPSILON ) continue;

				for ( const weights of fan ) blend( sources, written, start, weights );

			}

		}

	}

	if ( ! written[ 0 ].length ) return null;

	const band = new THREE.BufferGeometry();

	// Each attribute comes back in the type the plate published it in: a
	// producer quantizes normals and UVs, and a batch has one buffer per
	// attribute, so a band of plain floats could not join the geometries it
	// shares a material with.
	sources.forEach( ( source, at ) => {

		const { itemSize, normalized } = source;
		const values = written[ at ];
		const attribute = new THREE.BufferAttribute( new source.array.constructor( values.length ), itemSize, normalized );

		for ( let index = 0; index * itemSize < values.length; index ++ ) {

			for ( let part = 0; part < itemSize; part ++ ) attribute.setComponent( index, part, values[ index * itemSize + part ] );

		}

		band.setAttribute( ATTRIBUTES[ at ], attribute );

	} );

	return band;

}

/** The four convex regions the outside of a rectangle is, as half planes. */
function regions( { x0, z0, x1, z1 } ) {

	return [
		[ [ 0, x0, - 1 ] ],
		[ [ 0, x1, 1 ] ],
		[ [ 0, x0, 1 ], [ 0, x1, - 1 ], [ 1, z0, - 1 ] ],
		[ [ 0, x0, 1 ], [ 0, x1, - 1 ], [ 1, z1, 1 ] ]
	];

}

/** One triangle inside one region, as the weights of its corners. */
function clipped( region, x, z ) {

	let polygon = [ [ 1, 0, 0 ], [ 0, 1, 0 ], [ 0, 0, 1 ] ];

	for ( const [ axis, limit, keep ] of region ) {

		const source = axis === 0 ? x : z;
		const next = [];
		const side = ( weights ) => ( at( weights, source ) - limit ) * keep;

		for ( let i = 0; i < polygon.length && polygon.length; i ++ ) {

			const here = polygon[ i ];
			const there = polygon[ ( i + 1 ) % polygon.length ];
			const a = side( here );
			const b = side( there );

			if ( a >= - EPSILON ) next.push( here );
			if ( ( a > EPSILON && b < - EPSILON ) || ( a < - EPSILON && b > EPSILON ) ) {

				next.push( mix( here, there, a / ( a - b ) ) );

			}

		}
		polygon = next;
		if ( polygon.length < 3 ) return [];

	}

	return polygon;

}

function at( weights, values ) {

	return weights[ 0 ] * values[ 0 ] + weights[ 1 ] * values[ 1 ] + weights[ 2 ] * values[ 2 ];

}

function mix( a, b, t ) {

	return [ 0, 1, 2 ].map( ( k ) => a[ k ] + ( b[ k ] - a[ k ] ) * t );

}

/** Twice the area of a piece in the plate's own plane, to drop slivers. */
function area( fan, x, z ) {

	const [ ax, bx, cx ] = fan.map( ( weights ) => at( weights, x ) );
	const [ az, bz, cz ] = fan.map( ( weights ) => at( weights, z ) );

	return Math.abs( ( bx - ax ) * ( cz - az ) - ( cx - ax ) * ( bz - az ) );

}

function copy( sources, written, vertex ) {

	sources.forEach( ( source, at ) => {

		for ( let c = 0; c < source.itemSize; c ++ ) written[ at ].push( source.getComponent( vertex, c ) );

	} );

}

function blend( sources, written, start, weights ) {

	sources.forEach( ( source, at ) => {

		for ( let c = 0; c < source.itemSize; c ++ ) {

			written[ at ].push(
				weights[ 0 ] * source.getComponent( start, c )
				+ weights[ 1 ] * source.getComponent( start + 1, c )
				+ weights[ 2 ] * source.getComponent( start + 2, c )
			);

		}

	} );

}
