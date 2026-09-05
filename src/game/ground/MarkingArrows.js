/** Connected vector glyphs whose component polygons have disjoint interiors. */
export function arrowPolygons( turns, length, width ) {

	const straight = turns.includes( 's' );
	const left = turns.includes( 'l' );
	const right = turns.includes( 'r' );
	if ( ! straight && ! left && ! right ) return [];
	const stem = width * 0.18;
	const branch = length * 0.58;
	const headLength = length * 0.25;
	const top = straight ? length - headLength : branch + stem / 2;
	const cuts = [ 0, ...( left || right ? [ branch - stem / 2, branch + stem / 2 ] : [] ), top ]
		.filter( ( value, index, all ) => value <= top && all.indexOf( value ) === index ).sort( ( a, b ) => a - b );
	const result = cuts.slice( 1 ).map( ( end, i ) => rect( - stem / 2, cuts[ i ], stem / 2, end ) );
	if ( straight ) result.push( ...head( [ 0, length ], [ [ - width / 2, top ], [ - stem / 2, top ], [ stem / 2, top ], [ width / 2, top ] ] ) );
	for ( const sign of [ ...( left ? [ - 1 ] : [] ), ...( right ? [ 1 ] : [] ) ] ) {

		const base = sign * width * 0.3;
		result.push( rect( Math.min( base, sign * stem / 2 ), branch - stem / 2, Math.max( base, sign * stem / 2 ), branch + stem / 2 ) );
		result.push( ...head( [ sign * width / 2, branch ], [ [ base, branch - width * 0.3 ], [ base, branch - stem / 2 ],
			[ base, branch + stem / 2 ], [ base, branch + width * 0.3 ] ] ) );

	}
	return result;

}

const rect = ( left, bottom, right, top ) => [ [ left, bottom ], [ right, bottom ], [ right, top ], [ left, top ] ];
const head = ( tip, points ) => points.slice( 1 ).map( ( point, i ) => [ tip, points[ i ], point ] );
