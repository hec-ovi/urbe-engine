import * as THREE from 'three';
import { el } from './dom.js';
import { ShapePool, buildModel, frame } from './itemModels.js';

/** Thumbnails kept, oldest dropped first. */
const CACHE = 48;
/** Thumbnail work one frame may take before the next frame gets the rest. */
const FRAME_BUDGET_MS = 6;
const TURN = 0.012;
const TILT = 0.009;

/**
 * The one small 3D stage the inventory and the codex share: a still model in
 * the open screen's hero slot that the pointer or the arrow keys turn, and
 * bitmap thumbnails of any model for the cards. Nothing draws on its own: the
 * hero renders when its model, size or turn changes and each thumbnail once,
 * in frames asked for only while there is work and the stage is visible. The
 * WebGL renderer is made the first time a model has to be drawn; without WebGL
 * the hero reads `fallback` and thumbnails resolve null.
 * Models: { shape?, parts?, color?, seed? } (itemModels.js).
 */
export class ItemPreview {

	constructor( { thumbnailSize = 256, fallback = 'No preview' } = {} ) {

		this.size = thumbnailSize;
		this.visible = false;
		this.renderer = null;
		this.failed = false;
		this.pool = new ShapePool();
		this.cache = new Map();
		this.queue = new Map();
		this.frame = 0;
		this.model = null;
		this.pivot = null;
		this.built = null;
		this.dirty = false;
		this.turn = { x: 0, y: 0 };
		this.drag = null;

		this.canvas = el( 'canvas', { className: 'item-preview-canvas', tabIndex: 0 } );
		this.canvas.setAttribute( 'role', 'img' );
		this.status = el( 'span', { className: 'item-preview-status', textContent: fallback } );
		this.element = el( 'div', { className: 'item-preview' }, this.canvas, this.status );
		this.fallback = fallback;
		this.#bind();

	}

	/** Moves the stage into a screen's hero slot. */
	attach( parent ) {

		if ( this.element.parentElement !== parent ) parent.append( this.element );
		this.dirty = true;
		this.#schedule();

	}

	/**
	 * The hero's model and its accessible name; null shows the line instead.
	 * Returns whether it can be drawn.
	 */
	setModel( model, label = '' ) {

		this.canvas.setAttribute( 'aria-label', label ? `${label}, a 3D view: drag or use the arrow keys to turn it` : '' );
		const key = model ? keyOf( model ) : null;
		if ( key !== this.model?.key ) {

			this.model = model ? { ...model, key } : null;
			this.turn = { x: 0, y: 0 };
			this.#clearHero();
			this.canvas.classList.remove( 'is-arriving' );
			void this.canvas.offsetWidth;
			if ( model ) this.canvas.classList.add( 'is-arriving' );

		}
		const drawable = Boolean( model ) && this.#ready();
		this.canvas.hidden = ! drawable;
		this.status.hidden = drawable;
		this.status.textContent = this.fallback;
		this.dirty = drawable;
		this.#schedule();
		return drawable;

	}

	/** A bitmap URL of the model, drawn once and kept; null without WebGL. */
	thumbnail( model ) {

		const key = keyOf( model );
		if ( this.cache.has( key ) ) {

			const url = this.cache.get( key );
			this.cache.delete( key );
			this.cache.set( key, url );
			return Promise.resolve( url );

		}
		if ( ! this.#ready() ) return Promise.resolve( null );
		if ( ! this.queue.has( key ) ) {

			let resolve;
			const promise = new Promise( ( done ) => { resolve = done; } );
			this.queue.set( key, { model, promise, resolve } );

		}
		this.#schedule();
		return this.queue.get( key ).promise;

	}

	/** While hidden nothing is drawn; shown again, the hero and any waiting thumbnail are. */
	setVisible( visible ) {

		this.visible = Boolean( visible );
		if ( ! this.visible ) {

			cancelAnimationFrame( this.frame );
			this.frame = 0;
			this.drag = null;
			return;

		}
		this.dirty = Boolean( this.model );
		this.#schedule();

	}

	dispose() {

		cancelAnimationFrame( this.frame );
		this.frame = 0;
		this.#clearHero();
		for ( const job of this.queue.values() ) job.resolve( null );
		this.queue.clear();
		for ( const url of this.cache.values() ) if ( url.startsWith( 'blob:' ) ) URL.revokeObjectURL( url );
		this.cache.clear();
		this.pool.dispose();
		this.renderer?.dispose();
		this.renderer = null;
		this.element.remove();

	}

	#ready() {

		if ( this.renderer ) return true;
		if ( this.failed ) return false;
		const canvas = document.createElement( 'canvas' );
		try {

			if ( ! canvas.getContext( 'webgl2' ) ) throw new Error( 'no WebGL2' );
			this.renderer = new THREE.WebGLRenderer( { canvas, alpha: true, antialias: true, powerPreference: 'low-power' } );

		} catch {

			this.failed = true;
			return false;

		}
		this.renderer.setClearColor( 0x000000, 0 );
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.scene = new THREE.Scene();
		this.camera = new THREE.OrthographicCamera( - 1.7, 1.7, 1.7, - 1.7, 0.1, 30 );
		this.camera.position.set( 3, 2.15, 5 );
		this.camera.lookAt( 0, 0, 0 );
		const key = new THREE.DirectionalLight( 0xffe7c7, 2.4 );
		key.position.set( - 3, 5, 4 );
		const fill = new THREE.DirectionalLight( 0x83c4d1, 1.4 );
		fill.position.set( 4, 2, - 3 );
		this.scene.add( new THREE.HemisphereLight( 0xe2f2ed, 0x26333b, 1.9 ), key, fill );
		return true;

	}

	#clearHero() {

		this.pivot?.removeFromParent();
		this.built?.dispose();
		this.pivot = null;
		this.built = null;

	}

	#schedule() {

		if ( this.frame || ! this.visible || ! this.renderer ) return;
		if ( ! this.dirty && ! this.queue.size ) return;
		this.frame = requestAnimationFrame( () => {

			this.frame = 0;
			if ( ! this.visible || document.hidden ) return;
			const start = performance.now();
			for ( const [ key, job ] of this.queue ) {

				this.queue.delete( key );
				this.#thumbnail( key, job );
				if ( performance.now() - start > FRAME_BUDGET_MS ) break;

			}
			if ( this.dirty ) this.#hero();
			this.#schedule();

		} );

	}

	#hero() {

		this.dirty = false;
		if ( ! this.model || ! this.element.isConnected ) return;
		const width = this.element.clientWidth, height = this.element.clientHeight;
		if ( ! width || ! height ) return;
		if ( ! this.pivot ) {

			this.built = buildModel( this.model, this.pool );
			this.pivot = frame( this.built );

		}
		this.pivot.rotation.set( this.turn.x, this.turn.y, 0 );
		const ratio = Math.min( window.devicePixelRatio || 1, 1.5 );
		const w = Math.round( width * ratio ), h = Math.round( height * ratio );
		this.scene.add( this.pivot );
		this.#draw( w, h );
		this.pivot.removeFromParent();
		if ( this.canvas.width !== w || this.canvas.height !== h ) Object.assign( this.canvas, { width: w, height: h } );
		const context = this.canvas.getContext( '2d' );
		context.clearRect( 0, 0, w, h );
		context.drawImage( this.renderer.domElement, 0, 0 );

	}

	#thumbnail( key, job ) {

		let built = null;
		try {

			built = buildModel( job.model, this.pool );
			const pivot = frame( built );
			this.scene.add( pivot );
			this.#draw( this.size, this.size );
			pivot.removeFromParent();
			const canvas = this.renderer.domElement;
			const keep = ( url ) => {

				this.cache.set( key, url );
				while ( this.cache.size > CACHE ) {

					const [ oldest, old ] = this.cache.entries().next().value;
					this.cache.delete( oldest );
					if ( old.startsWith( 'blob:' ) ) URL.revokeObjectURL( old );

				}
				job.resolve( url );

			};
			// The encoding runs off the frame; the pixels are taken now.
			if ( canvas.toBlob ) canvas.toBlob( ( blob ) => keep( blob ? URL.createObjectURL( blob ) : canvas.toDataURL() ) );
			else keep( canvas.toDataURL() );

		} catch {

			job.resolve( null );

		} finally {

			built?.dispose();

		}

	}

	#draw( width, height ) {

		const size = this.renderer.getSize( new THREE.Vector2() );
		if ( size.x !== width || size.y !== height ) this.renderer.setSize( width, height, false );
		const aspect = width / height, half = 1.64;
		this.camera.left = - half * Math.max( 1, aspect );
		this.camera.right = - this.camera.left;
		this.camera.top = half / Math.min( 1, aspect );
		this.camera.bottom = - this.camera.top;
		this.camera.updateProjectionMatrix();
		this.renderer.render( this.scene, this.camera );

	}

	#bind() {

		this.canvas.addEventListener( 'pointerdown', ( event ) => {

			if ( event.button !== 0 || ! this.model ) return;
			this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
			this.canvas.setPointerCapture?.( event.pointerId );

		} );
		this.canvas.addEventListener( 'pointermove', ( event ) => {

			if ( this.drag?.id !== event.pointerId ) return;
			this.#turnBy( ( event.clientY - this.drag.y ) * TILT, ( event.clientX - this.drag.x ) * TURN );
			this.drag.x = event.clientX;
			this.drag.y = event.clientY;

		} );
		const release = () => { this.drag = null; };
		this.canvas.addEventListener( 'pointerup', release );
		this.canvas.addEventListener( 'pointercancel', release );
		this.canvas.addEventListener( 'keydown', ( event ) => {

			const step = { ArrowLeft: [ 0, - 0.15 ], ArrowRight: [ 0, 0.15 ], ArrowUp: [ - 0.12, 0 ], ArrowDown: [ 0.12, 0 ] }[ event.key ];
			if ( event.key === 'Home' ) this.turn = { x: 0, y: 0 };
			else if ( ! step ) return;
			event.preventDefault();
			if ( step ) this.#turnBy( ...step );
			this.dirty = true;
			this.#schedule();

		} );
		this.canvas.addEventListener( 'animationend', () => this.canvas.classList.remove( 'is-arriving' ) );

	}

	#turnBy( x, y ) {

		this.turn.x = Math.max( - 1, Math.min( 1, this.turn.x + x ) );
		this.turn.y += y;
		this.dirty = true;
		this.#schedule();

	}

}

/** What makes two models draw the same picture. */
function keyOf( model ) {

	return JSON.stringify( [ model.shape ?? '', model.color ?? '', model.seed ?? 0, model.parts ?? null ] );

}
