/** Lot corners arrive on Atlas' millimetre grid. */
const TOLERANCE = 0.001;

/**
 * The ground a kit building stands on. Pieces tile a rectangle, so a parcel
 * qualifies only when its lot is one, and Exterior reads a footprint wound so
 * that every corner turns the same way, with the building on the inward side
 * of each edge.
 *
 * @returns { footprint, width, depth } in world metres, or null for a lot no
 * set of square bays and corner arms can cover
 */
export function lotRectangle( lot ) {

	if ( ! Array.isArray( lot ) || lot.length !== 4 ) return null;

	for ( let corner = 0; corner < 4; corner ++ ) {

		const previous = direction( lot[ ( corner + 3 ) % 4 ], lot[ corner ] );
		const next = direction( lot[ corner ], lot[ ( corner + 1 ) % 4 ] );
		const square = previous.unit[ 0 ] * next.unit[ 0 ] + previous.unit[ 1 ] * next.unit[ 1 ];
		const opposite = next.length - distance( lot[ ( corner + 2 ) % 4 ], lot[ ( corner + 3 ) % 4 ] );

		if ( ! Number.isFinite( square ) || Math.abs( square ) > 1e-6 || Math.abs( opposite ) > TOLERANCE ) return null;

	}

	const first = direction( lot[ 0 ], lot[ 1 ] );
	const second = direction( lot[ 1 ], lot[ 2 ] );
	const turn = first.unit[ 0 ] * second.unit[ 1 ] - first.unit[ 1 ] * second.unit[ 0 ];
	const footprint = turn > 0 ? [ ...lot ] : [ lot[ 3 ], lot[ 2 ], lot[ 1 ], lot[ 0 ] ];

	return {
		footprint,
		width: distance( footprint[ 0 ], footprint[ 1 ] ),
		depth: distance( footprint[ 1 ], footprint[ 2 ] )
	};

}

function direction( from, to ) {

	const length = distance( from, to );

	return { unit: [ ( to[ 0 ] - from[ 0 ] ) / length, ( to[ 1 ] - from[ 1 ] ) / length ], length };

}

function distance( from, to ) {

	return Math.hypot( to[ 0 ] - from[ 0 ], to[ 1 ] - from[ 1 ] );

}
