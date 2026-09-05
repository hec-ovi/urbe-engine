/** Three-dimensional lane carrier with exact planar approach clipping. */
export class MarkingPath {

	constructor( points ) {

		this.points = points;
		this.stations = [ 0 ];
		for ( let i = 1; i < points.length; i ++ ) this.stations.push( this.stations[ i - 1 ] + distance( points[ i - 1 ], points[ i ] ) );
		this.length = this.stations.at( - 1 );

	}

	offset( width ) {

		const directions = this.points.slice( 1 ).map( ( point, i ) => tangent( this.points[ i ], point ) );
		return new MarkingPath( this.points.map( ( point, i ) => {

			const previous = directions[ Math.max( 0, i - 1 ) ];
			const next = directions[ Math.min( directions.length - 1, i ) ];
			const denominator = 1 + previous[ 0 ] * next[ 0 ] + previous[ 1 ] * next[ 1 ];
			if ( denominator < 1e-8 ) fail( 'Lane reverses at a marking join' );
			return [ point[ 0 ] - width * ( previous[ 1 ] + next[ 1 ] ) / denominator,
				point[ 1 ], point[ 2 ] + width * ( previous[ 0 ] + next[ 0 ] ) / denominator ];

		} ) );

	}

	at( station ) {

		const value = Math.max( 0, Math.min( this.length, station ) );
		let segment = this.stations.findIndex( end => end > value ) - 1;
		if ( segment < 0 ) segment = this.points.length - 2;
		const span = this.stations[ segment + 1 ] - this.stations[ segment ];
		return { point: lerp3( this.points[ segment ], this.points[ segment + 1 ], ( value - this.stations[ segment ] ) / span ),
			segment, tangent: tangent( this.points[ segment ], this.points[ segment + 1 ] ) };

	}

	/** Complete intervals outside every supplied field plane. */
	intervals( planes, inset = 0 ) {

		const result = [];
		for ( let i = 0; i + 1 < this.points.length; i ++ ) {

			const a = this.points[ i ];
			const b = this.points[ i + 1 ];
			let from = 0;
			let to = 1;
			for ( const plane of planes ) {

				const start = side( a, plane ) - inset;
				const end = side( b, plane ) - inset;
				if ( start < 0 && end < 0 ) { to = - 1; break; }
				if ( start < 0 ) from = Math.max( from, start / ( start - end ) );
				if ( end < 0 ) to = Math.min( to, start / ( start - end ) );

			}
			if ( to <= from ) continue;
			const length = this.stations[ i + 1 ] - this.stations[ i ];
			const interval = [ this.stations[ i ] + from * length, this.stations[ i ] + to * length ];
			if ( result.length && Math.abs( result.at( - 1 )[ 1 ] - interval[ 0 ] ) < 1e-8 ) result.at( - 1 )[ 1 ] = interval[ 1 ];
			else result.push( interval );

		}
		return result;

	}

	strip( from, to, width, shift = 0 ) {

		const stations = [ from, ...this.stations.filter( station => station > from && station < to ), to ];
		const clipped = new MarkingPath( stations.map( station => this.at( station ).point ) );
		const left = clipped.offset( shift + width / 2 ).points;
		const right = clipped.offset( shift - width / 2 ).points;
		return left.slice( 1 ).map( ( point, i ) => [ left[ i ], right[ i ], right[ i + 1 ], point ] );

	}

}

export const side = ( point, plane ) => point[ 0 ] * plane.normal[ 0 ] + point[ 2 ] * plane.normal[ 1 ] - plane.distance;
export const tangent = ( a, b ) => {
	const length = Math.hypot( b[ 0 ] - a[ 0 ], b[ 2 ] - a[ 2 ] );
	if ( length < 1e-9 ) fail( 'Lane has a zero-length horizontal segment' );
	return [ ( b[ 0 ] - a[ 0 ] ) / length, ( b[ 2 ] - a[ 2 ] ) / length ];
};
export const distance = ( a, b ) => Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ], b[ 2 ] - a[ 2 ] );
export const lerp3 = ( a, b, t ) => a.map( ( value, i ) => value + ( b[ i ] - value ) * t );
export function fail( message ) { throw Object.assign( new Error( message ), { code: 'E_GROUND_MARKINGS' } ); }
