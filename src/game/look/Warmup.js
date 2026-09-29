import { ColorManagement, NoToneMapping } from 'three/webgpu';
import { FrameBudget } from '../../app/FrameBudget.js';
import { programKey } from './ProgramKey.js';
import { ProgramPins, plainDraw } from './ProgramPins.js';

/**
 * Builds pipelines and maps before a frame first draws them.
 *
 * Hidden or off-camera objects are staged for compilation and restored exactly.
 * The compile uses the render pipeline's multiple render target because that
 * decides which fragment program the visible frame requests.
 *
 * What the renderer builds is a graph per material and vertex layout, and per
 * object where the draw is instanced or batched, because the graph binds that
 * object's own textures (ProgramKey.js). One renderable of each is prepared
 * here, the way the renderer would on its first draw, and every program that
 * compile linked is pinned in the renderer's own cache (ProgramPins.js), so a
 * batch that grows or a floor that leaves never costs the frame a link again.
 *
 * Between programs and between map uploads the work asks a frame budget for
 * its turn: while the game loads there is no frame to protect and the turn is
 * one pass of the event loop once a few milliseconds are spent; once `pace`
 * says the city is drawn, it is a frame.
 */
export class Warmup {

	/**
	 * @param scene the scene the object lives in or is going to, for its lights
	 * @param mrt the render pipeline's scene-pass MRT, or null when it has none
	 * @param uploaded, pins, budget shared with a sibling warm-up, which
	 *   prepares the same world for another render target
	 * @param budget the FrameBudget asked between programs and uploads; paced
	 *   (a frame per turn) unless the caller is still loading
	 */
	constructor( renderer, scene, camera, mrt = null, renderTarget = null, {
		uploaded = new WeakSet(), pins = new ProgramPins(), budget = new FrameBudget()
	} = {} ) {

		this.renderer = renderer;
		this.scene = scene;
		this.camera = camera;
		this.mrt = mrt;
		this.renderTarget = renderTarget;
		this.uploaded = uploaded;
		this.warmed = new Set();
		this.pins = pins;
		this.budget = budget;
		this.preparing = Promise.resolve();

	}

	/** From now on each turn is a frame: the city is drawn and has something to lose. */
	pace() {

		this.budget.pace();

	}

	/**
	 * The same world prepared for another pass: the renderer keeps a graph per
	 * render target, so a probe's cube faces ask for graphs of their own. Maps
	 * uploaded, programs pinned and the budget are shared, because those are
	 * the same.
	 */
	sibling( { camera = this.camera, renderTarget = this.renderTarget, mrt = this.mrt } = {} ) {

		return new Warmup( this.renderer, this.scene, camera, mrt, renderTarget, {
			uploaded: this.uploaded, pins: this.pins, budget: this.budget
		} );

	}

	/**
	 * @param object anything in the scene graph, in the scene or still detached
	 * @returns milliseconds the warm-up took, or 0 when it could not run
	 */
	async warm( object ) {

		if ( ! object || ! this.renderer?.compileAsync ) return 0;
		const started = performance.now();
		try {

			const programs = this.programsOf( object );
			await this.#prepare( object, programs.every( ( [ node ] ) => plainDraw( node ) ) );
			for ( const [ , key ] of programs ) this.warmed.add( key );

		} catch ( error ) {

			console.warn( `warmup: ${error?.message ?? error}` );

		}
		return performance.now() - started;

	}

	/** @param plain whether every draw in the object keeps its graph across objects, so its graphs are pinned too */
	async #prepare( object, plain ) {

		const pending = this.preparing.then( () => this.#compile( object, plain ) );
		this.preparing = pending.catch( () => {} );
		return pending;

	}

	async #compile( object, plain ) {

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
			this.pins.pin( this.renderer, plain );

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

	/** Decodes and uploads each new map once, asking the budget between uploads. */
	async #upload( object ) {

		const textures = texturesOf( object ).filter( ( { texture } ) => ! this.uploaded.has( texture ) );

		for ( let index = 0; index < textures.length; index ++ ) {

			const { texture, ready } = textures[ index ];
			await Promise.all( ready );
			this.renderer.initTexture?.( texture );
			this.uploaded.add( texture );
			// A map a dropped floor disposes is uploaded again the next time a
			// floor wears it, not on the frame that first draws it.
			texture.addEventListener?.( 'dispose', () => this.uploaded.delete( texture ) );
			await this.budget.step();

		}

	}

	/**
	 * Warms one representative of every program this object still needs, one at
	 * a time so the backend never receives an unbounded set in one request, and
	 * pins what each one linked.
	 *
	 * @param skip subtrees left out, such as the groups a probe never renders
	 * @returns milliseconds the pass took; `onProgress` counts programs, not
	 * renderables, so the work reported is the work left to do
	 */
	async warmAll( object, { wanted = () => true, onProgress = () => {}, skip = () => false } = {} ) {

		if ( ! object ) return 0;
		const wantedPrograms = this.programsOf( object, skip );
		const started = performance.now();

		for ( let index = 0; index < wantedPrograms.length; index ++ ) {

			if ( ! wanted() ) break;
			const [ node, key ] = wantedPrograms[ index ];
			await this.#prepare( node, plainDraw( node ) );
			this.warmed.add( key );
			onProgress( index + 1, wantedPrograms.length );
			if ( index + 1 < wantedPrograms.length ) await this.budget.step();

		}

		return performance.now() - started;

	}

	/** One renderable per program this object needs and this warm-up lacks. */
	programsOf( object, skip = () => false ) {

		const wantedPrograms = [];
		const seen = new Set();
		const visit = ( node ) => {

			if ( skip( node ) ) return;
			if ( node.material ) {

				const key = programKey( node );
				if ( ! seen.has( key ) && ! this.warmed.has( key ) ) {

					seen.add( key );
					wantedPrograms.push( [ node, key ] );

				}

			}
			for ( const child of node.children ) visit( child );

		};

		if ( object ) visit( object );

		return wantedPrograms;

	}

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
