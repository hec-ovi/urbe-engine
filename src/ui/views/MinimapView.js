import { el } from '../components/dom.js';

const SIZE = 190;
const PIXELS_PER_METRE = 1.6;
const ROAD = '#4a6684';
const BLOCK = '#18212c';
const GROUND = '#0a0e14';
const PLAYER = '#cfe6ff';

/**
 * Top-down map of the city with the player at its centre, north up. The whole
 * city is drawn once into an offscreen canvas when the map is handed over;
 * every frame only blits that canvas at an offset and draws the marker, so the
 * minimap costs one image copy however big the city is.
 *
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
		this.baked = null;
		this.origin = [ 0, 0 ];
		this.setVisible( true );

	}

	/**
	 * @param map { bounds: { min: [x,z], max: [x,z] }, roads: [{ path, width }], blocks: [ring] }
	 */
	setMap( { bounds, roads, blocks } ) {

		const pad = 40;
		const width = Math.ceil( ( bounds.max[ 0 ] - bounds.min[ 0 ] + pad * 2 ) * PIXELS_PER_METRE );
		const height = Math.ceil( ( bounds.max[ 1 ] - bounds.min[ 1 ] + pad * 2 ) * PIXELS_PER_METRE );

		this.origin = [ bounds.min[ 0 ] - pad, bounds.min[ 1 ] - pad ];
		this.baked = el( 'canvas', { width, height } );

		const ctx = this.baked.getContext( '2d' );
		ctx.fillStyle = GROUND;
		ctx.fillRect( 0, 0, width, height );

		ctx.fillStyle = BLOCK;

		for ( const ring of blocks ) {

			ctx.beginPath();
			ring.forEach( ( [ x, z ], i ) => {

				const p = this.#toPixels( x, z );
				i ? ctx.lineTo( p[ 0 ], p[ 1 ] ) : ctx.moveTo( p[ 0 ], p[ 1 ] );

			} );
			ctx.closePath();
			ctx.fill();

		}

		ctx.strokeStyle = ROAD;
		ctx.lineCap = 'round';

		for ( const road of roads ) {

			ctx.lineWidth = Math.max( 1.5, road.width * PIXELS_PER_METRE );
			ctx.beginPath();
			road.path.forEach( ( [ x, z ], i ) => {

				const p = this.#toPixels( x, z );
				i ? ctx.lineTo( p[ 0 ], p[ 1 ] ) : ctx.moveTo( p[ 0 ], p[ 1 ] );

			} );
			ctx.stroke();

		}

	}

	/** @param heading yaw in radians; the player looks along (-sin, -cos) in [x, z]. */
	update( position, heading ) {

		if ( this.element.hidden || ! this.baked ) return;

		const ctx = this.context;
		const [ px, pz ] = this.#toPixels( position.x, position.z );

		ctx.fillStyle = GROUND;
		ctx.fillRect( 0, 0, SIZE, SIZE );
		ctx.drawImage( this.baked, SIZE / 2 - px, SIZE / 2 - pz );

		const dx = - Math.sin( heading );
		const dz = - Math.cos( heading );
		const c = SIZE / 2;

		ctx.fillStyle = PLAYER;
		ctx.beginPath();
		ctx.moveTo( c + dx * 7, c + dz * 7 );
		ctx.lineTo( c - dx * 4 - dz * 4, c - dz * 4 + dx * 4 );
		ctx.lineTo( c - dx * 4 + dz * 4, c - dz * 4 - dx * 4 );
		ctx.closePath();
		ctx.fill();

	}

	toggle() {

		this.setVisible( this.element.hidden );

	}

	setVisible( visible ) {

		this.element.hidden = ! visible;

	}

	#toPixels( x, z ) {

		return [
			( x - this.origin[ 0 ] ) * PIXELS_PER_METRE,
			( z - this.origin[ 1 ] ) * PIXELS_PER_METRE
		];

	}

}
