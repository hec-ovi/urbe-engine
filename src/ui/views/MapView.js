import { el } from '../components/dom.js';
import { icon } from '../components/Icon.js';
import { PanelHeader } from '../components/PanelHeader.js';
import { CityBake } from './CityBake.js';
import { MapCamera } from './MapCamera.js';
import { MapPainter, MAP_COLORS } from './MapPainter.js';

const BAKE_PIXELS_PER_METRE = 2;
const WHEEL_STEP = 1.15;

const LEGEND = [
	[ 'you', MAP_COLORS.player ],
	[ 'venue open', MAP_COLORS.venueOpen ],
	[ 'venue shut', MAP_COLORS.venueShut ],
	[ 'station', MAP_COLORS.station ],
	[ 'marker', MAP_COLORS.marker ],
	[ 'road', MAP_COLORS.road ],
	[ 'block', MAP_COLORS.block ]
];

/**
 * The full city map: pan by dragging, zoom with the wheel, north up. The city
 * is baked once per setMap; the canvas is redrawn only on pan, zoom or a data
 * change, never per frame. Follows the player until the first drag.
 * props: { onClose }
 */
export class MapView {

	constructor( { onClose } ) {

		this.camera = new MapCamera();
		this.bake = null;
		this.venues = [];
		this.stations = [];
		this.markers = [];
		this.player = null;
		this.follow = true;
		this.drag = null;

		this.canvas = el( 'canvas', { className: 'map-canvas' } );
		this.context = this.canvas.getContext( '2d' );

		this.centreButton = el( 'button', { className: 'hud-button', type: 'button', textContent: 'centre on me' } );
		this.centreButton.addEventListener( 'click', () => this.centre() );

		this.stage = el( 'div', { className: 'map-stage' },
			this.canvas,
			el( 'div', { className: 'map-north' }, icon( 'north' ), 'N' ),
			el( 'div', { className: 'map-legend' }, ...LEGEND.map( ( [ label, color ] ) => el( 'div', { className: 'map-legend-item' },
				el( 'span', { className: 'map-swatch', style: `background:${color}` } ),
				label
			) ) ),
			el( 'div', { className: 'map-tools' }, 'drag to pan, wheel to zoom', this.centreButton )
		);

		this.header = new PanelHeader( { title: 'Map', key: 'M', onClose } );
		this.element = el( 'div', { className: 'view view-map' }, this.header.element, this.stage );

		this.#bindPointer();

	}

	/**
	 * @param map { bounds, roads, blocks, stations: [{ point: [x,z], name }],
	 *   markers: [{ point: [x,z], label }] }; stations and markers optional.
	 */
	setMap( { bounds, roads, blocks, stations = [], markers = [] } ) {

		this.bake = new CityBake( { bounds, roads, blocks }, BAKE_PIXELS_PER_METRE );
		this.stations = stations;
		this.markers = markers;
		this.bounds = bounds;
		this.camera.fit( bounds );
		this.redraw();

	}

	/** @param venues [{ point: { x, z }, open }] */
	setVenues( venues ) {

		this.venues = venues;
		this.redraw();

	}

	/** @param heading yaw in radians. Same values as last time cost nothing. */
	setPlayer( position, heading ) {

		const next = [ position.x, position.z, heading ];

		if ( this.player && next.every( ( v, i ) => v === this.player[ i ] ) ) return;

		this.player = next;

		if ( this.follow ) this.camera.centreOn( position.x, position.z );

		this.redraw();

	}

	/** Back to the player, following again. */
	centre() {

		this.follow = true;

		if ( this.player ) this.camera.centreOn( this.player[ 0 ], this.player[ 1 ] );

		this.redraw();

	}

	/** The host calls this once the view is on screen, so the canvas can measure itself. */
	shown() {

		const width = this.stage.clientWidth;
		const height = this.stage.clientHeight;

		if ( width !== this.canvas.width || height !== this.canvas.height ) {

			this.canvas.width = width;
			this.canvas.height = height;
			this.camera.resize( width, height );

			if ( this.bounds && ! this.player ) this.camera.fit( this.bounds );

		}

		this.redraw();

	}

	redraw() {

		if ( this.element.hidden || ! this.bake ) return;

		const ctx = this.context;
		const scale = this.camera.zoom / this.bake.pixelsPerMetre;
		const [ ox, oy ] = this.camera.toScreen( this.bake.origin[ 0 ], this.bake.origin[ 1 ] );

		ctx.fillStyle = MAP_COLORS.ground;
		ctx.fillRect( 0, 0, this.canvas.width, this.canvas.height );
		ctx.drawImage( this.bake.canvas, ox, oy, this.bake.canvas.width * scale, this.bake.canvas.height * scale );

		for ( const venue of this.venues ) {

			MapPainter.venue( ctx, ...this.camera.toScreen( venue.point.x, venue.point.z ), venue.open );

		}

		for ( const station of this.stations ) {

			MapPainter.station( ctx, ...this.camera.toScreen( ...station.point ) );

		}

		for ( const marker of this.markers ) {

			MapPainter.marker( ctx, ...this.camera.toScreen( ...marker.point ), marker.label );

		}

		if ( this.player ) {

			MapPainter.player( ctx, ...this.camera.toScreen( this.player[ 0 ], this.player[ 1 ] ), this.player[ 2 ] );

		}

	}

	#bindPointer() {

		this.stage.addEventListener( 'pointerdown', ( event ) => {

			this.drag = [ event.clientX, event.clientY ];
			this.stage.classList.add( 'is-dragging' );

		} );

		this.stage.addEventListener( 'pointermove', ( event ) => {

			if ( ! this.drag ) return;

			this.follow = false;
			this.camera.pan( event.clientX - this.drag[ 0 ], event.clientY - this.drag[ 1 ] );
			this.drag = [ event.clientX, event.clientY ];
			this.redraw();

		} );

		const release = () => {

			this.drag = null;
			this.stage.classList.remove( 'is-dragging' );

		};

		this.stage.addEventListener( 'pointerup', release );
		this.stage.addEventListener( 'pointerleave', release );

		this.stage.addEventListener( 'wheel', ( event ) => {

			event.preventDefault();
			const rect = this.canvas.getBoundingClientRect();
			this.camera.zoomAt( event.clientX - rect.left, event.clientY - rect.top, event.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP );
			this.redraw();

		}, { passive: false } );

		window.addEventListener( 'resize', () => {

			if ( ! this.element.hidden ) this.shown();

		} );

	}

}
