import { el } from '../components/dom.js';
import { CityBake } from './CityBake.js';
import { MapPainter, MAP_COLORS } from './MapPainter.js';
import { MinimapFrame } from './MinimapFrame.js';
import layout from './minimap-layout.json' with { type: 'json' };

const SIZE = layout.size;
/** Under half a pixel of movement, or of turn at the map's corner, repaints nothing a player could see. */
const STILL_METRES = 0.5 / layout.pixelsPerMetre;
const STILL_RADIANS = 0.5 / SIZE;

/**
 * Corner map with the player at its centre, forward up. The city is baked once
 * when the map is handed over; every frame turns it with the player and draws
 * the live marks, so the minimap costs one image copy however big the city.
 * Presentation only: it is handed plain [x, z] geometry and a position.
 * A frame that would paint what is already there, the player standing still
 * with the same marks, paints nothing.
 */
export class MinimapView {

	/** What the canvas shows: where from, which way, which venues open; null when it must be painted. */
	#painted = null;

	constructor( { onOpen } = {} ) {

		this.canvas = el( 'canvas', { className: 'hud-minimap-canvas', width: SIZE, height: SIZE, ariaLabel: layout.label } );
		this.routeLabel = el( 'span', { className: 'hud-minimap-route', textContent: 'Local area' } );
		this.element = el( onOpen ? 'button' : 'div', { className: 'hud-minimap', ...( onOpen ? { type: 'button', ariaLabel: 'Open city map' } : {} ) },
			el( 'span', { className: 'hud-minimap-top', textContent: 'LOCAL NAVIGATION', ariaHidden: 'true' } ),
			this.canvas,
			el( 'span', { className: 'hud-minimap-label' }, this.routeLabel, el( 'span', { textContent: 'M / MAP' } ) )
		);
		if ( onOpen ) this.element.addEventListener( 'click', onOpen );
		this.context = this.canvas.getContext( '2d' );
		this.bake = null;
		this.venues = [];
		this.route = null;
		this.setVisible( true );

	}

	/** @param map city bounds, roads, blocks and generated 2D transit routes and places. */
	setMap( map ) {

		this.bake = new CityBake( map, layout.pixelsPerMetre );
		this.#painted = null;

	}

	/** One dot per enterable venue, lit while open. @param venues [{ point: { x, z }, open }] */
	setVenues( venues ) {

		this.venues = venues;
		this.#painted = null;

	}

	/** @param route { path: [[x,z]], label: string } or null */
	setRoute( route ) {

		this.route = route;
		this.routeLabel.textContent = route?.label || 'Local area';
		this.#painted = null;

	}

	/** @param heading yaw in radians; the player looks along (-sin, -cos) in [x, z]. */
	update( position, heading ) {

		if ( this.element.hidden || ! this.bake ) return;

		// A venue opens and shuts in place, without being handed over again.
		let open = 0;
		for ( let i = 0; i < this.venues.length; i ++ ) if ( this.venues[ i ].open ) open = ( open * 31 + i + 1 ) | 0;
		const painted = this.#painted;
		if ( painted && painted.open === open
			&& Math.abs( painted.x - position.x ) < STILL_METRES && Math.abs( painted.z - position.z ) < STILL_METRES
			&& Math.abs( painted.heading - heading ) < STILL_RADIANS ) return;
		this.#painted = { x: position.x, z: position.z, heading, open };

		const ctx = this.context;
		const c = SIZE / 2;
		const frame = new MinimapFrame( this.bake, position, heading, c );

		ctx.fillStyle = MAP_COLORS.ground;
		ctx.fillRect( 0, 0, SIZE, SIZE );
		frame.paintCity( ctx );

		if ( this.route ) {

			const toScreen = ( x, z ) => frame.toScreen( x, z );

			MapPainter.route( ctx, this.route.path, toScreen );
			const destination = this.route.path.at( - 1 );
			if ( destination ) {

				const [ x, y ] = toScreen( destination[ 0 ], destination[ 1 ] );
				MapPainter.marker( ctx, x, y, '' );

			}

		}

		for ( const venue of this.venues ) {

			const [ x, y ] = frame.toScreen( venue.point.x, venue.point.z );

			if ( x < 0 || y < 0 || x > SIZE || y > SIZE ) continue;

			MapPainter.venue( ctx, x, y, venue.open );

		}

		MapPainter.player( ctx, c, c, 0 );
		frame.paintNorth( ctx, layout.north, layout.compassInset );

	}

	toggle() {

		this.setVisible( this.element.hidden );

	}

	setVisible( visible ) {

		this.element.hidden = ! visible;
		this.#painted = null;

	}

}
