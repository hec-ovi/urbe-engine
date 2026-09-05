/** Exact boundary predicates on the Float32 lattice used by ground buffers. */
export class EncodedRing {

	constructor( ring ) {

		this.points = ring.map( point => point.map( Math.fround ) );
		const buffer = new DataView( new ArrayBuffer( 4 ) );
		// Every finite Float32 is an integer multiple of 2^-149.
		this.integers = this.points.map( point => point.map( value => {

			buffer.setFloat32( 0, value );
			const bits = buffer.getUint32( 0 );
			const exponent = ( bits >>> 23 ) & 255;
			const mantissa = BigInt( ( bits & 0x7fffff ) | ( exponent ? 0x800000 : 0 ) );
			return ( bits >>> 31 ? - mantissa : mantissa ) << BigInt( exponent ? exponent - 1 : 0 );

		} ) );

	}

	turn( a, b, c ) {

		const p = this.integers[ a ], q = this.integers[ b ], r = this.integers[ c ];
		return ( q[ 0 ] - p[ 0 ] ) * ( r[ 1 ] - p[ 1 ] ) - ( q[ 1 ] - p[ 1 ] ) * ( r[ 0 ] - p[ 0 ] );

	}

	isSimple() {

		const p = this.points, n = p.length;
		if ( n < 3 || p.some( point => point.some( value => ! Number.isFinite( value ) ) )
			|| new Set( p.map( point => point.join( ',' ) ) ).size !== n ) return false;
		let area = 0n;
		for ( let i = 0; i < n; i ++ ) {

			const next = ( i + 1 ) % n, previous = ( i + n - 1 ) % n;
			area += this.turn( 0, i, next );
			if ( this.turn( previous, i, next ) === 0n && ! between( p[ i ], p[ previous ], p[ next ] ) ) return false;
			for ( let j = i + 2; j < n; j ++ ) {

				const end = ( j + 1 ) % n;
				if ( end === i || separated( p[ i ], p[ next ], p[ j ], p[ end ] ) ) continue;
				const sides = [ this.turn( i, next, j ), this.turn( i, next, end ), this.turn( j, end, i ), this.turn( j, end, next ) ];
				if ( sides[ 0 ] * sides[ 1 ] <= 0n && sides[ 2 ] * sides[ 3 ] <= 0n ) return false;

			}

		}
		return area !== 0n;

	}

}

const between = ( point, a, b ) => point.every( ( value, axis ) => value >= Math.min( a[ axis ], b[ axis ] ) && value <= Math.max( a[ axis ], b[ axis ] ) );
const separated = ( a, b, c, d ) => [ 0, 1 ].some( axis => Math.max( a[ axis ], b[ axis ] ) < Math.min( c[ axis ], d[ axis ] )
	|| Math.max( c[ axis ], d[ axis ] ) < Math.min( a[ axis ], b[ axis ] ) );
