/**
 * The panel graph of one variant set and its distinct-neighbour colouring,
 * in typed arrays, so a whole city's panels colour off the main thread in a
 * few tens of megabytes ([VariantColoring](VariantColoring.js) for the rule).
 *
 * Two panels are neighbours when an edge of one and an edge of the other have
 * the same two ends, to the centimetre, in plan: the same midpoint, length and
 * direction. Edges are found by sorting each edge's midpoint code with its
 * owner, so equal edges lie side by side, and the panels are coloured in the
 * order the caller hands them over, which is their canonical identity order.
 */

const PRIME = 16777619;
const SPAN = 2 ** 20, UNITS = 2 ** 21;

/** FNV-1a continued over one 32-bit word, little-endian. */
function word( hash, value ) {

	for ( let shift = 0; shift < 32; shift += 8 ) hash = Math.imul( hash ^ ( ( value >>> shift ) & 255 ), PRIME ) >>> 0;

	return hash;

}

/**
 * @param weights the set's authored weight of each variant
 * @param units `{ count, corners, prefix, panel }`: four corners per panel in
 *   world metres (12 numbers each, in order round it), each panel's placement
 *   hash prefix and its number in its part, in canonical order
 * @returns `{ colors, conflicts, edges, counts }`
 */
export function colorGraph( weights, { count, corners, prefix, panel } ) {

	// Each edge as one 63-bit code: midpoint x and z in half centimetres (20 bits
	// each, a city up to 5 km across) above the owner's index and side (23 bits).
	// An edge beyond that, or a set of more than two million panels, joins nothing.
	const codes = new BigUint64Array( count * 4 );
	let x0 = Infinity, z0 = Infinity;
	for ( let i = 0; i < count * 4; i ++ ) {

		x0 = Math.min( x0, corners[ i * 3 ] );
		z0 = Math.min( z0, corners[ i * 3 + 2 ] );

	}
	const edgeOf = ( unit, side ) => {

		const a = unit * 12 + side * 3, b = unit * 12 + ( ( side + 1 ) % 4 ) * 3;
		return [ corners[ a ], corners[ a + 2 ], corners[ b ], corners[ b + 2 ] ];

	};
	let n = 0;
	for ( let unit = 0; unit < count; unit ++ ) {

		for ( let side = 0; side < 4; side ++ ) {

			const [ ax, az, bx, bz ] = edgeOf( unit, side );
			if ( Math.hypot( bx - ax, bz - az ) < 0.01 ) continue;
			const mx = Math.round( ( ax + bx - 2 * x0 ) * 100 ), mz = Math.round( ( az + bz - 2 * z0 ) * 100 );
			if ( mx >= SPAN || mz >= SPAN || unit >= UNITS ) continue;
			codes[ n ++ ] = ( BigInt( mx ) << 43n ) | ( BigInt( mz ) << 23n ) | BigInt( unit * 4 + side );

		}

	}
	const sorted = codes.subarray( 0, n ).sort();
	const LOW = ( 1n << 23n ) - 1n;
	const pairs = [];
	for ( let i = 0; i < n; ) {

		const point = sorted[ i ] >> 23n;
		let j = i + 1;
		while ( j < n && ( sorted[ j ] >> 23n ) === point ) j ++;
		for ( let p = i; p < j; p ++ ) for ( let q = p + 1; q < j; q ++ ) {

			const a = Number( sorted[ p ] & LOW ), b = Number( sorted[ q ] & LOW );
			const ua = a >> 2, ub = b >> 2;
			if ( ua === ub ) continue;
			// The same midpoint is the same edge only when the ends agree too.
			const [ ax, az, bx, bz ] = edgeOf( ua, a & 3 ), [ cx, cz, dx, dz ] = edgeOf( ub, b & 3 );
			const same = ( Math.hypot( ax - cx, az - cz ) < 0.01 && Math.hypot( bx - dx, bz - dz ) < 0.01 )
				|| ( Math.hypot( ax - dx, az - dz ) < 0.01 && Math.hypot( bx - cx, bz - cz ) < 0.01 );
			if ( same ) pairs.push( ua, ub );

		}
		i = j;

	}

	// Neighbour lists, compressed.
	const degree = new Uint32Array( count + 1 );
	for ( let k = 0; k < pairs.length; k ++ ) degree[ pairs[ k ] + 1 ] ++;
	for ( let k = 0; k < count; k ++ ) degree[ k + 1 ] += degree[ k ];
	const fill = degree.slice( 0, count ), list = new Uint32Array( pairs.length );
	for ( let k = 0; k < pairs.length; k += 2 ) {

		list[ fill[ pairs[ k ] ] ++ ] = pairs[ k + 1 ];
		list[ fill[ pairs[ k + 1 ] ] ++ ] = pairs[ k ];

	}

	const colors = new Uint8Array( count ).fill( 255 );
	const counts = new Array( weights.length ).fill( 0 );
	const open = new Float64Array( weights.length );
	let conflicts = 0;
	for ( let unit = 0; unit < count; unit ++ ) {

		open.set( weights );
		for ( let k = degree[ unit ]; k < degree[ unit + 1 ]; k ++ ) {

			const color = colors[ list[ k ] ];
			if ( color !== 255 ) open[ color ] = 0;

		}
		let total = 0;
		for ( const weight of open ) total += weight;
		const u = word( prefix[ unit ], panel[ unit ] ) / 4294967296;
		const chosen = total > 0 ? pick( open, u * total ) : pick( weights, u );
		if ( total <= 0 ) conflicts ++;
		colors[ unit ] = chosen;
		counts[ chosen ] ++;

	}

	return { colors, conflicts, edges: pairs.length / 2, counts };

}

/** The first variant whose running weight passes `at`. */
function pick( weights, at ) {

	let running = 0, last = 0;
	for ( let variant = 0; variant < weights.length; variant ++ ) {

		if ( weights[ variant ] <= 0 ) continue;
		running += weights[ variant ];
		last = variant;
		if ( running > at ) return variant;

	}

	return last;

}
