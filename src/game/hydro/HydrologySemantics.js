import { HydrologyError } from './HydrologyError.js';

const EPSILON = 1e-8;

/** Semantic checks JSON Schema cannot express: identity, winding and topology. */
export function validateHydrologySemantics( plan ) {

	const ids = new Set();
	const bodies = new Map();

	for ( const body of plan.bodies ) {

		claim( ids, body.id );
		bodies.set( body.id, body );
		if ( body.type !== plan.type ) fail( `Water body ${body.id} does not match hydrology type ${plan.type}` );
		if ( body.materialKey !== `water.${body.type}` ) fail( `Water body ${body.id} has the wrong material key` );
		if ( body.surfaces.length !== body.shorelines.length ) fail( `Water body ${body.id} has unmatched surfaces and shorelines` );

		for ( let index = 0; index < body.surfaces.length; index ++ ) {

			const surface = body.surfaces[ index ];
			const shoreline = body.shorelines[ index ];
			validateRing( surface, `Water surface ${body.id}:${index}` );
			claim( ids, shoreline.id );
			if ( ! sameRing( surface, shoreline.path ) ) fail( `Shoreline ${shoreline.id} is not watertight with its surface` );
			if ( shoreline.band.length !== shoreline.path.length ) fail( `Shoreline ${shoreline.id} has one band per edge` );

			for ( let edge = 0; edge < shoreline.band.length; edge ++ ) {

				const band = shoreline.band[ edge ];
				validateRing( band, `Shoreline band ${shoreline.id}:${edge}` );
				if ( ! samePoint( band[ 0 ], shoreline.path[ edge ] )
					|| ! samePoint( band[ 1 ], shoreline.path[ ( edge + 1 ) % shoreline.path.length ] ) ) {
					fail( `Shoreline band ${shoreline.id}:${edge} does not begin on its exact edge` );
				}
			}

		}

	}

	for ( const crossing of plan.structures ) {

		claim( ids, crossing.id );
		if ( ! bodies.has( crossing.waterBodyId ) ) fail( `Crossing ${crossing.id} names an absent water body` );

	}

}

export function signedArea( ring ) {

	let sum = 0;
	for ( let index = 0; index < ring.length; index ++ ) {

		const point = ring[ index ];
		const next = ring[ ( index + 1 ) % ring.length ];
		sum += point[ 0 ] * next[ 1 ] - next[ 0 ] * point[ 1 ];

	}
	return sum / 2;

}

function validateRing( ring, label ) {

	if ( signedArea( ring ) <= EPSILON ) fail( `${label} must be counter-clockwise with non-zero area` );
	for ( let index = 0; index < ring.length; index ++ ) {

		if ( samePoint( ring[ index ], ring[ ( index + 1 ) % ring.length ] ) ) fail( `${label} has a zero-length edge` );

	}
	for ( let left = 0; left < ring.length; left ++ ) {

		for ( let right = left + 1; right < ring.length; right ++ ) {

			if ( adjacent( left, right, ring.length ) ) continue;
			if ( segmentsTouch( ring[ left ], ring[ ( left + 1 ) % ring.length ], ring[ right ], ring[ ( right + 1 ) % ring.length ] ) ) {

				fail( `${label} self-intersects` );

			}

		}

	}

}

function claim( ids, id ) {

	if ( ids.has( id ) ) fail( `Duplicate hydrology identity ${id}` );
	ids.add( id );

}

function sameRing( left, right ) {

	return left.length === right.length && left.every( ( point, index ) => samePoint( point, right[ index ] ) );

}

function samePoint( left, right ) {

	return left[ 0 ] === right[ 0 ] && left[ 1 ] === right[ 1 ];

}

function adjacent( left, right, length ) {

	return left === right || ( left + 1 ) % length === right || ( right + 1 ) % length === left;

}

function segmentsTouch( a, b, c, d ) {

	const sides = [ side( a, b, c ), side( a, b, d ), side( c, d, a ), side( c, d, b ) ];
	if ( sides[ 0 ] * sides[ 1 ] < - EPSILON && sides[ 2 ] * sides[ 3 ] < - EPSILON ) return true;
	return ( Math.abs( sides[ 0 ] ) <= EPSILON && onSegment( c, a, b ) )
		|| ( Math.abs( sides[ 1 ] ) <= EPSILON && onSegment( d, a, b ) )
		|| ( Math.abs( sides[ 2 ] ) <= EPSILON && onSegment( a, c, d ) )
		|| ( Math.abs( sides[ 3 ] ) <= EPSILON && onSegment( b, c, d ) );

}

function side( a, b, point ) {

	return ( b[ 0 ] - a[ 0 ] ) * ( point[ 1 ] - a[ 1 ] ) - ( b[ 1 ] - a[ 1 ] ) * ( point[ 0 ] - a[ 0 ] );

}

function onSegment( point, a, b ) {

	return point[ 0 ] >= Math.min( a[ 0 ], b[ 0 ] ) - EPSILON
		&& point[ 0 ] <= Math.max( a[ 0 ], b[ 0 ] ) + EPSILON
		&& point[ 1 ] >= Math.min( a[ 1 ], b[ 1 ] ) - EPSILON
		&& point[ 1 ] <= Math.max( a[ 1 ], b[ 1 ] ) + EPSILON;

}

function fail( message ) {

	throw new HydrologyError( 'E_HYDRO_INPUT', message );

}
