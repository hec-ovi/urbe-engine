const MIN_ZOOM = 0.25;
const MAX_ZOOM = 16;

/**
 * Where the map is looking: a world centre in metres and a zoom in pixels
 * per metre, mapped onto a viewport. North is up: screen y grows with z.
 */
export class MapCamera {

	constructor() {

		this.centre = [ 0, 0 ];
		this.zoom = 2;
		this.width = 0;
		this.height = 0;

	}

	resize( width, height ) {

		this.width = width;
		this.height = height;

	}

	toScreen( x, z ) {

		return [
			( x - this.centre[ 0 ] ) * this.zoom + this.width / 2,
			( z - this.centre[ 1 ] ) * this.zoom + this.height / 2
		];

	}

	toWorld( sx, sy ) {

		return [
			( sx - this.width / 2 ) / this.zoom + this.centre[ 0 ],
			( sy - this.height / 2 ) / this.zoom + this.centre[ 1 ]
		];

	}

	centreOn( x, z ) {

		this.centre = [ x, z ];

	}

	/** Move the view by a screen offset in pixels. */
	pan( dx, dy ) {

		this.centre = [ this.centre[ 0 ] - dx / this.zoom, this.centre[ 1 ] - dy / this.zoom ];

	}

	/** Scale about a screen point, so what sits under the cursor stays put. */
	zoomAt( sx, sy, factor ) {

		const [ wx, wz ] = this.toWorld( sx, sy );
		this.zoom = Math.min( MAX_ZOOM, Math.max( MIN_ZOOM, this.zoom * factor ) );
		this.centre = [
			wx - ( sx - this.width / 2 ) / this.zoom,
			wz - ( sy - this.height / 2 ) / this.zoom
		];

	}

	/** Frame a world rectangle { min: [x,z], max: [x,z] } with some margin. */
	fit( bounds ) {

		const w = bounds.max[ 0 ] - bounds.min[ 0 ];
		const h = bounds.max[ 1 ] - bounds.min[ 1 ];
		this.centreOn( bounds.min[ 0 ] + w / 2, bounds.min[ 1 ] + h / 2 );

		if ( this.width > 0 && this.height > 0 ) {

			this.zoom = Math.min( MAX_ZOOM, Math.max( MIN_ZOOM, 0.9 * Math.min( this.width / w, this.height / h ) ) );

		}

	}

}
