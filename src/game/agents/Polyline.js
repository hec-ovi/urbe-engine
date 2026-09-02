/**
 * Distance along an authoritative 3D [x,y,z] movement path. Walk edges and
 * road lanes are both polylines with a travel distance, so both measure and
 * sample through here without discarding grade.
 */

/** @returns { path, cumulative, length, mid } */
export function measure( path, label = 'path3' ) {

	validate( path, label );

	const cumulative = [ 0 ];

	for ( let i = 1; i < path.length; i ++ ) {

		const [ ax, ay, az ] = path[ i - 1 ];
		const [ bx, by, bz ] = path[ i ];
		cumulative.push( cumulative[ i - 1 ] + Math.hypot( bx - ax, by - ay, bz - az ) );

	}

	const length = cumulative[ cumulative.length - 1 ];
	const mid = sample( { path, cumulative, length }, length / 2, 1 );

	return { path, cumulative, length, mid: [ mid.x, mid.y, mid.z ] };

}

/**
 * Position and heading at `distance` along the line.
 * @param direction 1 travels start->end, -1 travels end->start.
 */
export function sample( line, distance, direction ) {

	const travel = direction === 1 ? distance : line.length - distance;
	const { cumulative, path } = line;
	let i = 1;

	while ( i < cumulative.length - 1 && cumulative[ i ] < travel ) i ++;

	const span = cumulative[ i ] - cumulative[ i - 1 ] || 1;
	const t = ( travel - cumulative[ i - 1 ] ) / span;
	const a = path[ i - 1 ];
	const b = path[ i ];

	return {
		x: a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * t,
		y: a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t,
		z: a[ 2 ] + ( b[ 2 ] - a[ 2 ] ) * t,
		heading: Math.atan2( ( b[ 0 ] - a[ 0 ] ) * direction, ( b[ 2 ] - a[ 2 ] ) * direction ),
		pitch: Math.atan2(
			( b[ 1 ] - a[ 1 ] ) * direction,
			Math.hypot( b[ 0 ] - a[ 0 ], b[ 2 ] - a[ 2 ] )
		)
	};

}

function validate( path, label ) {

	if ( ! Array.isArray( path ) || path.length < 2 ) fail( label, 'must contain at least two points' );

	for ( let i = 0; i < path.length; i ++ ) {

		const point = path[ i ];

		if ( ! Array.isArray( point ) || point.length !== 3 || point.some( ( value ) => ! Number.isFinite( value ) ) ) {

			fail( `${label}[${i}]`, 'must be three finite numbers' );

		}

	}

}

function fail( label, reason ) {

	const error = new Error( `E_MOVEMENT_PATH3: ${label} ${reason}` );
	error.code = 'E_MOVEMENT_PATH3';
	throw error;

}
