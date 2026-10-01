import * as THREE from 'three/webgpu';

/** The side of every picture, in pixels. */
export const SIZE = 256;
/** The neutral dark backdrop: its centre and its edge, a soft radial falloff between. */
const BACKDROP = { centre: [ 0.05, 0.08, 0.09 ], edge: [ 0.012, 0.024, 0.028 ] };

/**
 * Small pictures of the game's own things, drawn by the game's renderer into a
 * render target off screen and read back without waiting on the frame: one at
 * a time, and only when the host steps it (GameApp does while the world holds
 * still), so a picture never costs a frame of play.
 *
 * `take( stage )` queues one: `stage()` (it may be async) answers
 * `{ scene, camera, done?() }` or null, `done` runs once the scene is drawn.
 * The promise resolves with the picture's URL, or null when it cannot be had.
 * `step()` does the next piece of work: stages the picture asked for last (a
 * screen asks for what it shows now last), or draws the staged one and starts
 * reading it back; nothing while a stage or a read is under way.
 */
export class Snapshots {

	/**
	 * @param renderer the game's renderer
	 * @param encode turns `{ data, size }` (8-bit RGBA, top row first) into a URL; a PNG blob by default
	 */
	constructor( { renderer, size = SIZE, encode = encodePng } ) {

		this.renderer = renderer;
		this.size = size;
		this.encode = encode;
		this.queue = [];
		/** The picture being staged or drawn. */
		this.current = null;
		this.busy = false;
		this.target = null;

	}

	get pending() {

		return this.queue.length + ( this.current ? 1 : 0 );

	}

	take( stage ) {

		return new Promise( ( resolve ) => this.queue.push( { stage, resolve, staged: null } ) );

	}

	step() {

		if ( this.busy ) return;
		const job = this.current ??= this.queue.pop() ?? null;
		if ( ! job ) return;
		this.busy = true;
		if ( ! job.staged ) {

			Promise.resolve().then( () => job.stage() ).then( ( staged ) => {

				if ( staged ) job.staged = staged;
				else this.#drop( job, null );

			}, ( error ) => this.#drop( job, error ) ).finally( () => { this.busy = false; } );
			return;

		}
		this.current = null;
		let reading;
		try {

			reading = this.#draw( job.staged );

		} catch ( error ) {

			reading = Promise.reject( error );

		} finally {

			job.staged.done?.();

		}
		const flip = ! this.renderer.backend?.isWebGPUBackend;
		reading
			.then( ( pixels ) => this.encode( picture( pixels, this.size, { flip } ) ) )
			.then( job.resolve, ( error ) => {

				console.warn( `snapshot: ${error?.message ?? error}` );
				job.resolve( null );

			} )
			.finally( () => { this.busy = false; } );

	}

	dispose() {

		for ( const job of [ ...this.queue, ...( this.current ? [ this.current ] : [] ) ] ) {

			job.staged?.done?.();
			job.resolve( null );

		}
		this.queue = [];
		this.current = null;
		this.target?.dispose();
		this.target = null;

	}

	#drop( job, error ) {

		if ( error ) console.warn( `snapshot: ${error?.message ?? error}` );
		if ( this.current === job ) this.current = null;
		job.resolve( null );

	}

	/** Draws the scene into the target as the probe draws a face: linear, untoned, no MRT, the renderer's state put back. */
	#draw( { scene, camera } ) {

		const renderer = this.renderer;
		const webgpu = renderer.backend?.isWebGPUBackend === true;
		// WebGPU blends half floats everywhere; WebGL reads full floats back on every implementation.
		this.target ??= new THREE.RenderTarget( this.size, this.size, { type: webgpu ? THREE.HalfFloatType : THREE.FloatType, depthBuffer: true } );
		const previous = renderer.getRenderTarget();
		const mrt = renderer.getMRT?.() ?? null;
		const tone = renderer.toneMapping, color = renderer.outputColorSpace;
		const clear = renderer.getClearColor( new THREE.Color() ), alpha = renderer.getClearAlpha();
		try {

			renderer.setRenderTarget( this.target );
			renderer.setMRT?.( null );
			renderer.toneMapping = THREE.NoToneMapping;
			renderer.outputColorSpace = THREE.ColorManagement.workingColorSpace;
			renderer.setClearColor( 0x000000, 0 );
			renderer.clear();
			renderer.render( scene, camera );

		} finally {

			renderer.setRenderTarget( previous );
			renderer.setMRT?.( mrt );
			renderer.toneMapping = tone;
			renderer.outputColorSpace = color;
			renderer.setClearColor( clear, alpha );

		}
		return renderer.readRenderTargetPixelsAsync( this.target, 0, 0, this.size, this.size );

	}

}

/**
 * A read-back render (linear RGBA as floats, or half floats as 16-bit words)
 * as an 8-bit picture over the backdrop: tone mapped (ACES), encoded to sRGB,
 * top row first (`flip` turns a bottom-first WebGL read the right way up).
 */
export function picture( pixels, size, { flip = false, exposure = 1 } = {} ) {

	const half = pixels instanceof Uint16Array;
	const value = half ? ( index ) => THREE.DataUtils.fromHalfFloat( pixels[ index ] ) : ( index ) => pixels[ index ];
	const data = new Uint8ClampedArray( size * size * 4 );
	const middle = Math.max( 0.5, ( size - 1 ) / 2 );
	for ( let y = 0; y < size; y ++ ) {

		const row = flip ? size - 1 - y : y;
		for ( let x = 0; x < size; x ++ ) {

			const from = ( row * size + x ) * 4, to = ( y * size + x ) * 4;
			const reach = falloff( Math.hypot( x - middle, y - middle * 0.8 ) / ( size * 0.6 ), Math.max( Math.abs( x - middle ), Math.abs( y - middle ) ) / middle );
			const alpha = Math.min( 1, Math.max( 0, value( from + 3 ) ) );
			for ( let channel = 0; channel < 3; channel ++ ) {

				const ground = BACKDROP.centre[ channel ] + ( BACKDROP.edge[ channel ] - BACKDROP.centre[ channel ] ) * reach;
				const lit = tone( Math.max( 0, value( from + channel ) ) * exposure );
				data[ to + channel ] = Math.round( srgb( ground * ( 1 - alpha ) + lit * alpha ) * 255 );

			}
			data[ to + 3 ] = 255;

		}

	}
	return { data, size };

}

/** How far to the edge colour a pixel is: soft from the centre, and all the way at every border so the square has no seam. */
function falloff( round, square ) {

	const edge = Math.min( 1, Math.max( 0, ( square - 0.82 ) / 0.18 ) );
	return Math.min( 1, Math.max( round * round * ( 3 - 2 * round ), edge ) );

}

/** ACES filmic, Narkowicz's fit. */
function tone( x ) {

	return Math.min( 1, ( x * ( 2.51 * x + 0.03 ) ) / ( x * ( 2.43 * x + 0.59 ) + 0.14 ) );

}

function srgb( linear ) {

	return linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow( linear, 1 / 2.4 ) - 0.055;

}

/** A picture as a PNG blob URL, encoded off the frame. */
export function encodePng( { data, size } ) {

	const canvas = document.createElement( 'canvas' );
	canvas.width = canvas.height = size;
	canvas.getContext( '2d' ).putImageData( new ImageData( data, size, size ), 0, 0 );
	return new Promise( ( resolve ) => canvas.toBlob( ( blob ) => resolve( blob ? URL.createObjectURL( blob ) : null ), 'image/png' ) );

}
