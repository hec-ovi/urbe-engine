/** Shared geometry finishes keep local wear stable without per-instance materials. */
export class SurfaceVariation {
	static apply( parts, finish ) {
		for ( const part of parts ) {
			const { position, color, uv } = part.geometry.attributes;
			if ( part.tintable && color ) for ( let i = 0; i < position.count; i ++ ) {
				const x = position.getX( i ), y = position.getY( i ), z = position.getZ( i );
				const wave = Math.sin( x * 4.7 + z * 2.9 + finish.phase ) * Math.cos( y * 3.1 - z * 1.8 + finish.phase );
				const grime = finish.wear * ( 0.45 + wave * 0.25 + 0.3 * Math.exp( - Math.max( 0, y ) * 3 ) );
				color.setXYZ( i, color.getX( i ) * ( 1 - grime ), color.getY( i ) * ( 1 - grime * 0.92 ), color.getZ( i ) * ( 1 - grime * 0.8 ) );
			}
			if ( part.tintable && ! part.fitted ) for ( let i = 0; i < uv.count; i ++ ) uv.setXY( i, uv.getX( i ) + finish.offset[ 0 ], uv.getY( i ) + finish.offset[ 1 ] );
		}
		return parts;
	}
}
