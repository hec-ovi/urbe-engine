import { el } from '../components/dom.js';
import { CityBake } from './CityBake.js';
import { MapPainter, MAP_COLORS } from './MapPainter.js';

const SIZE = 190;
const PIXELS_PER_METRE = 1.6;

/**
 * Corner map with the player at its centre, north up. The city is baked once
 * when the map is handed over; every frame blits it at an offset and draws
 * the live marks, so the minimap costs one image copy however big the city.
 * Presentation only: it is handed plain [x, z] geometry and a position.
 */
export class MinimapView {

	constructor() {

		this.canvas = el( 'canvas', { className: 'hud-minimap-canvas', width: SIZE, height: SIZE } );
		this.element = el( 'div', { className: 'hud-minimap' },
			this.canvas,
			el( 'div', { className: 'hud-minimap-label', textContent: 'M' } )
		);
		this.context = this.canvas.getContext( '2d' );
		this.bake = null;
		this.venues = [];
		this.route = null;
		this.setVisible( true );

	}

	/** @param map { bounds: { min: [x,z], max: [x,z] }, roads: [{ path, width }], blocks: [ring] } */
	setMap( map ) {

		this.bake = new CityBake( map, PIXELS_PER_METRE );

	}

	/** One dot per enterable venue, lit while open. @param venues [{ point: { x, z }, open }] */
	setVenues( venues ) {

		this.venues = venues;

	}

	/** @param route { path: [[x,z]], label: string } or null */
	setRoute( route ) {

		this.route = route;

	}

	/** @param heading yaw in radians; the player looks along (-sin, -cos) in [x, z]. */
	update( position, heading ) {

		if ( this.element.hidden || ! this.bake ) return;

		const ctx = this.context;
		const [ px, pz ] = this.bake.toPixels( position.x, position.z );
		const c = SIZE / 2;

		ctx.fillStyle = MAP_COLORS.ground;
		ctx.fillRect( 0, 0, SIZE, SIZE );
		ctx.drawImage( this.bake.canvas, c - px, c - pz );

		if ( this.route ) {

			const toScreen = ( x, z ) => {

				const [ rx, rz ] = this.bake.toPixels( x, z );
				return [ c - px + rx, c - pz + rz ];

			};

			MapPainter.route( ctx, this.route.path, toScreen );
			const destination = this.route.path.at( - 1 );
			if ( destination ) {

				const [ x, y ] = toScreen( destination[ 0 ], destination[ 1 ] );
				MapPainter.marker( ctx, x, y, '' );

			}

		}

		for ( const venue of this.venues ) {

			const [ vx, vz ] = this.bake.toPixels( venue.point.x, venue.point.z );
			const x = c - px + vx;
			const y = c - pz + vz;

			if ( x < 0 || y < 0 || x > SIZE || y > SIZE ) continue;

			MapPainter.venue( ctx, x, y, venue.open );

		}

		MapPainter.player( ctx, c, c, heading );

	}

	toggle() {

		this.setVisible( this.element.hidden );

	}

	setVisible( visible ) {

		this.element.hidden = ! visible;

	}

}
