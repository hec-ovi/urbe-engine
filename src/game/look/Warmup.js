import { ColorManagement, NoToneMapping } from 'three/webgpu';
import { frameYield } from '../../app/FrameYield.js';

/**
 * Builds WebGPU pipelines and maps before a frame first draws them.
 *
 * Hidden or off-camera objects are staged for compilation and restored exactly.
 * The compile uses the render pipeline's multiple render target because that
 * decides which fragment program the visible frame requests.
 *
 * What the backend builds is a program: one material drawn with one vertex
 * layout. The city draws the same few dozen materials over thousands of
 * batches, cells and pages, so one renderable warms every copy of its program
 * and the rest cost nothing. Programs already built stay built for the life of
 * this warm-up, whichever pass asked for them.
 */
export class Warmup {

	/**
	 * @param scene the scene the object lives in or is going to, for its lights
	 * @param mrt the render pipeline's scene-pass MRT, or null when it has none
	 */
	constructor( renderer, scene, camera, mrt = null, renderTarget = null ) {

		this.renderer = renderer;
		this.scene = scene;
		this.camera = camera;
		this.mrt = mrt;
		this.renderTarget = renderTarget;
		this.uploaded = new WeakSet();
		this.warmed = new Set();
		this.preparing = Promise.resolve();

	}

	/**
	 * @param object anything in the scene graph, in the scene or still detached
	 * @returns milliseconds the warm-up took, or 0 when it could not run
	 */
	async warm( object ) {

		if ( ! object || ! this.renderer?.compileAsync ) return 0;
		const started = performance.now();
		try {

			await this.#prepare( object );

		} catch ( error ) {

			console.warn( `warmup: ${error?.message ?? error}` );

		}
		return performance.now() - started;

	}

	async #prepare( object ) {

		const pending = this.preparing.then( () => this.#compile( object ) );
		this.preparing = pending.catch( () => {} );
		return pending;

	}

	async #compile( object ) {

		if ( ! object || ! this.renderer?.compileAsync ) return;
		let shown = null;
		let previous;
		let previousTarget;
		let previousTone, previousColor;

		try {

			await this.#upload( object );
			shown = stage( object );
			previous = this.renderer.getMRT?.() ?? null;
			previousTarget = this.renderer.getRenderTarget?.() ?? null;
			previousTone = this.renderer.toneMapping;
			previousColor = this.renderer.outputColorSpace;
			if ( this.renderTarget ) {

				this.renderer.toneMapping = NoToneMapping;
				this.renderer.outputColorSpace = ColorManagement.workingColorSpace;

			}
			this.renderer.setRenderTarget?.( this.renderTarget );
			this.renderer.setMRT?.( this.mrt );
			await this.renderer.compileAsync( object, this.camera, this.scene );

		} finally {

			if ( shown ) {

				this.renderer.setMRT?.( previous );
				this.renderer.setRenderTarget?.( previousTarget );
				this.renderer.toneMapping = previousTone;
				this.renderer.outputColorSpace = previousColor;
				restore( shown );

			}

		}

	}

	/** Decodes and uploads each new map once, yielding between individual uploads. */
	async #upload( object ) {

		const textures = texturesOf( object ).filter( ( { texture } ) => ! this.uploaded.has( texture ) );

		for ( let index = 0; index < textures.length; index ++ ) {

			const { texture, ready } = textures[ index ];
			await Promise.all( ready );
			this.renderer.initTexture?.( texture );
			this.uploaded.add( texture );
			await frameYield();

		}

	}

	/**
	 * Warms one representative of every program this object still needs, one at
	 * a time so the backend never receives an unbounded set in one request.
	 *
	 * @returns milliseconds the pass took; `onProgress` counts programs, not
	 * renderables, so the work reported is the work left to do
	 */
	async warmAll( object, { wanted = () => true, onProgress = () => {} } = {} ) {

		if ( ! object ) return 0;
		const wantedPrograms = this.programsOf( object );
		const started = performance.now();

		for ( let index = 0; index < wantedPrograms.length; index ++ ) {

			if ( ! wanted() ) break;
			const [ node, key ] = wantedPrograms[ index ];
			await this.#prepare( node );
			this.warmed.add( key );
			onProgress( index + 1, wantedPrograms.length );
			if ( index + 1 < wantedPrograms.length ) await frameYield();

		}

		return performance.now() - started;

	}

	/** One renderable per program this object needs and this warm-up lacks. */
	programsOf( object ) {

		const wantedPrograms = [];
		const seen = new Set();

		object?.traverse( ( node ) => {

			if ( ! node.material ) return;
			const key = programKey( node );
			if ( seen.has( key ) || this.warmed.has( key ) ) return;
			seen.add( key );
			wantedPrograms.push( [ node, key ] );

		} );

		return wantedPrograms;

	}

}

/**
 * What the backend builds one of: the material, and the vertex layout it is
 * drawn with. Two renderables that agree on both request the same program,
 * whichever batch, cell or page they belong to.
 */
function programKey( node ) {

	const materials = Array.isArray( node.material ) ? node.material : [ node.material ];
	const attributes = Object.keys( node.geometry?.attributes ?? {} ).sort().join( ',' );
	const morphs = Object.keys( node.geometry?.morphAttributes ?? {} ).sort().join( ',' );
	const kind = [
		node.isInstancedMesh, node.isBatchedMesh, node.isSkinnedMesh, node.isPoints, node.isLine,
		node.instanceColor, node.geometry?.isInstancedBufferGeometry
	].map( ( flag ) => ( flag ? 1 : 0 ) ).join( '' );

	return `${materials.map( ( material ) => material?.uuid ?? 'none' ).join( '+' )}|${kind}|${attributes}|${morphs}`;

}

function stage( object ) {

	const shown = [];

	object.traverse( ( node ) => {

		const count = node.isInstancedMesh ? node.count : undefined;
		const instanceCount = node.geometry?.isInstancedBufferGeometry ? node.geometry.instanceCount : undefined;
		shown.push( [ node, node.visible, node.frustumCulled, count, instanceCount ] );
		// Keep the active light budget intact. Making every city light visible
		// would exceed the fixed DynamicLighting arrays used by WebGL.
		if ( ! node.isLight ) node.visible = true;
		node.frustumCulled = false;
		if ( count === 0 ) node.count = 1;
		if ( instanceCount === 0 ) node.geometry.instanceCount = 1;

	} );

	return shown;

}

function restore( shown ) {

	for ( const [ node, visible, culled, count, instanceCount ] of shown ) {

		node.visible = visible;
		node.frustumCulled = culled;
		if ( count !== undefined ) node.count = count;
		if ( instanceCount !== undefined ) node.geometry.instanceCount = instanceCount;

	}

}

/** Shared maps and explicit node-material resources, with all readiness promises. */
function texturesOf( object ) {

	const textures = new Map();
	const add = ( texture, ready ) => {

		if ( ! texture?.isTexture ) throw new Error( 'Invalid material texture resource' );
		if ( ! textures.has( texture ) ) textures.set( texture, new Set() );
		const pending = textures.get( texture );
		pending.add( texture[ Symbol.for( 'urbe.texture-ready' ) ] );
		if ( ready ) pending.add( ready );

	};

	object.traverse( ( node ) => {

		const materials = Array.isArray( node.material ) ? node.material : [ node.material ];

		for ( const material of materials ) {

			if ( ! material ) continue;
			for ( const value of Object.values( material ) ) if ( value?.isTexture ) add( value );
			for ( const resource of material[ Symbol.for( 'urbe.material-resources' ) ] ?? [] ) {

				if ( typeof resource?.ready?.then !== 'function' ) throw new Error( 'Material texture readiness is required' );
				add( resource.texture, resource.ready );

			}

		}

	} );

	return [ ...textures ].map( ( [ texture, ready ] ) => ( { texture, ready: [ ...ready ] } ) );

}
