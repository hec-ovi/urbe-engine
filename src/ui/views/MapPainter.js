/** The one palette both maps draw with; the legend reads it too. */
export const MAP_COLORS = {
	ground: '#0a0e14',
	block: '#18212c',
	road: '#4a6684',
	player: '#cfe6ff',
	venueOpen: '#ffc46b',
	venueShut: '#4a4136',
	station: '#2ee6ff',
	marker: '#ff5fa8',
	route: '#69f4ff'
};

/**
 * Drawing routines shared by the minimap and the full map. The city layers
 * take a toPixels( x, z ) mapping so the caller decides scale and origin;
 * the live marks are drawn at a screen point in constant pixel sizes.
 */
export class MapPainter {

	/** Ground, blocks and roads of the whole city, baked once. */
	static city( ctx, { roads, blocks }, toPixels, pixelsPerMetre, width, height ) {

		ctx.fillStyle = MAP_COLORS.ground;
		ctx.fillRect( 0, 0, width, height );

		ctx.fillStyle = MAP_COLORS.block;

		for ( const ring of blocks ) {

			MapPainter.#trace( ctx, ring, toPixels );
			ctx.closePath();
			ctx.fill();

		}

		ctx.strokeStyle = MAP_COLORS.road;
		ctx.lineCap = 'butt';

		for ( const road of roads ) {

			ctx.lineWidth = Math.max( 1.5, road.width * pixelsPerMetre );
			MapPainter.#trace( ctx, road.path, toPixels );
			ctx.stroke();

		}

	}

	static venue( ctx, x, y, open ) {

		ctx.fillStyle = open ? MAP_COLORS.venueOpen : MAP_COLORS.venueShut;
		ctx.fillRect( x - 2, y - 2, 4, 4 );

	}

	/** The active objective path, kept legible over the baked street layer. */
	static route( ctx, points, toPixels ) {

		if ( points.length < 2 ) return;

		ctx.strokeStyle = MAP_COLORS.route;
		ctx.lineWidth = 3;
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		MapPainter.#trace( ctx, points, toPixels );
		ctx.stroke();

	}

	/** A framed square: transit stops and station entrances. */
	static station( ctx, x, y ) {

		ctx.strokeStyle = MAP_COLORS.station;
		ctx.lineWidth = 1.5;
		ctx.strokeRect( x - 3.5, y - 3.5, 7, 7 );

	}

	/** A labelled diamond: quest and custom marks. */
	static marker( ctx, x, y, label ) {

		ctx.fillStyle = MAP_COLORS.marker;
		ctx.beginPath();
		ctx.moveTo( x, y - 6 );
		ctx.lineTo( x + 6, y );
		ctx.lineTo( x, y + 6 );
		ctx.lineTo( x - 6, y );
		ctx.closePath();
		ctx.fill();

		if ( ! label ) return;

		ctx.font = '10px ui-monospace, monospace';
		ctx.textBaseline = 'middle';
		ctx.fillText( label, x + 9, y );

	}

	/** @param heading yaw in radians; the player looks along (-sin, -cos) in [x, z]. */
	static player( ctx, x, y, heading ) {

		const dx = - Math.sin( heading );
		const dz = - Math.cos( heading );

		ctx.fillStyle = MAP_COLORS.player;
		ctx.beginPath();
		ctx.moveTo( x + dx * 7, y + dz * 7 );
		ctx.lineTo( x - dx * 4 - dz * 4, y - dz * 4 + dx * 4 );
		ctx.lineTo( x - dx * 4 + dz * 4, y - dz * 4 - dx * 4 );
		ctx.closePath();
		ctx.fill();

	}

	static #trace( ctx, points, toPixels ) {

		ctx.beginPath();
		points.forEach( ( [ x, z ], i ) => {

			const p = toPixels( x, z );
			i ? ctx.lineTo( p[ 0 ], p[ 1 ] ) : ctx.moveTo( p[ 0 ], p[ 1 ] );

		} );

	}

}
