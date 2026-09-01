/**
 * Distance along a 2D [x,z] polyline. Walk edges and road lanes are both
 * polylines with a travel distance, so both measure and sample through here.
 */

/** @returns { path, cumulative, length, mid } */
export function measure( path ) {

	const cumulative = [ 0 ];

	for ( let i = 1; i < path.length; i ++ ) {

		const [ ax, az ] = path[ i - 1 ];
		const [ bx, bz ] = path[ i ];
		cumulative.push( cumulative[ i - 1 ] + Math.hypot( bx - ax, bz - az ) );

	}

	const length = cumulative[ cumulative.length - 1 ];
	const mid = sample( { path, cumulative, length }, length / 2, 1 );

	return { path, cumulative, length, mid: [ mid.x, mid.z ] };

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
		z: a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t,
		heading: Math.atan2( ( b[ 0 ] - a[ 0 ] ) * direction, ( b[ 1 ] - a[ 1 ] ) * direction )
	};

}
