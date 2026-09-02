/**
 * The local frame of a station footprint: where its centre is, which way its
 * long axis runs and how big it is. Atlas publishes these as plain quads in
 * world metres at whatever angle the line runs at, and every stair, landing and
 * mouth inside one is laid out along its own axes rather than the world's.
 */
export function frameOf( ring ) {

	let axis = null;
	let longest = 0;

	for ( let i = 0; i < ring.length; i ++ ) {

		const a = ring[ i ];
		const b = ring[ ( i + 1 ) % ring.length ];
		const length = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );

		if ( length > longest ) {

			longest = length;
			axis = [ ( b[ 0 ] - a[ 0 ] ) / length, ( b[ 1 ] - a[ 1 ] ) / length ];

		}

	}

	if ( ! axis ) return null;

	const centre = [ 0, 0 ];

	for ( const [ x, z ] of ring ) {

		centre[ 0 ] += x / ring.length;
		centre[ 1 ] += z / ring.length;

	}

	const across = [ - axis[ 1 ], axis[ 0 ] ];
	const span = ( direction ) => {

		let low = Infinity;
		let high = - Infinity;

		for ( const [ x, z ] of ring ) {

			const t = ( x - centre[ 0 ] ) * direction[ 0 ] + ( z - centre[ 1 ] ) * direction[ 1 ];
			low = Math.min( low, t );
			high = Math.max( high, t );

		}

		return high - low;

	};

	return {
		centre, axis, across,
		long: span( axis ),
		short: span( across ),
		/** World point at `along` metres up the long axis and `off` across it. */
		at: ( along, off ) => [
			centre[ 0 ] + axis[ 0 ] * along + across[ 0 ] * off,
			centre[ 1 ] + axis[ 1 ] * along + across[ 1 ] * off
		],
		/** How far up the long axis a world point sits, from the centre. */
		along: ( x, z ) => ( x - centre[ 0 ] ) * axis[ 0 ] + ( z - centre[ 1 ] ) * axis[ 1 ],
		/** The heading, in radians, that turns +Z onto the long axis. */
		heading: Math.atan2( axis[ 0 ], axis[ 1 ] )
	};

}
