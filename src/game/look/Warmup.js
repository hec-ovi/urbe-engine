import { ColorManagement, NoToneMapping } from 'three/webgpu';
/** Below this a program's graph or a map's upload is not written in the hitch log. */
const NOTED_MS = 4;
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
	 * @param uploaded, pins, queue shared with a sibling warm-up, which
	 *   prepares the same world for another render target
	 * @param budget the FrameBudget asked between programs and uploads; paced
	 *   (a frame per turn) unless the caller is still loading
	 * @param hitches the HitchLog a graph build or a map upload that holds the
	 *   thread is named in, so a frame it lands in says which it was
	 */
	constructor( renderer, scene, camera, mrt = null, renderTarget = null, {
		uploaded = new WeakSet(), pins = new ProgramPins(), budget = new FrameBudget(), queue = { tail: Promise.resolve() }, hitches = null, shadow = null
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
		this.hitches = hitches;
		// One compile at a time for the whole family: each sets the renderer's
		// target and outputs for as long as its graph builds.
		this.queue = queue;
		/**
		 * The shadow pass a caster is also drawn by, `() => { camera, target,
		 * material, shadow } | null` (light/SunShadow.js `pass`): the frame's
		 * own warm-up builds those programs too, since a caster's first
		 * daylight frame would otherwise build them mid-play.
		 */
		this.shadow = shadow;

	}

	/** From now on each turn is a frame: the city is drawn and has something to lose. */
	pace() {

		this.budget.pace();

	}

	/**
	 * The same world prepared for another pass: the renderer keeps a graph per
	 * render target, so a probe's cube faces ask for graphs of their own. Maps
	 * uploaded, programs pinned and the queue are shared, because those are
	 * the same; the budget too unless the pass brings its own.
	 */
	sibling( { camera = this.camera, renderTarget = this.renderTarget, mrt = this.mrt, budget = this.budget } = {} ) {

		return new Warmup( this.renderer, this.scene, camera, mrt, renderTarget, {
			uploaded: this.uploaded, pins: this.pins, budget, queue: this.queue, hitches: this.hitches
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

		const pending = this.queue.tail.then( () => this.#compile( object, plain ) );
		this.queue.tail = pending.catch( () => {} );
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
			// The graphs build before the call returns; the programs link after it.
			const started = performance.now();
			const compiling = this.renderer.compileAsync( object, this.camera, this.scene );
			const held = performance.now() - started;
			if ( held >= NOTED_MS ) this.hitches?.note( `warm-up ${nameOf( object )}`, held );
			await compiling;
			this.pins.pin( this.renderer, plain );
			// The frame's graphs make the shadow's map, so its pass comes second.
			const pass = this.shadow?.() ?? null;
			if ( pass && casts( object ) ) {

				await this.#compileShadow( object, pass );
				this.pins.pin( this.renderer, plain );

			}

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

	/**
	 * The object as the shadow pass draws it: its casters alone, every one
	 * with the pass's material, into the map. The map is not drawn while the
	 * graphs build: a receiving material's first build would otherwise render it.
	 */
	async #compileShadow( object, pass ) {

		const hidden = [];
		object.traverse( ( node ) => {

			if ( node.material && ! node.castShadow && node.visible ) {

				hidden.push( node );
				node.visible = false;

			}

		} );
		const override = this.scene.overrideMaterial;
		const drawing = pass.shadow.needsUpdate;
		const tone = this.renderer.toneMapping;
		const space = this.renderer.outputColorSpace;

		try {

			pass.shadow.needsUpdate = false;
			this.scene.overrideMaterial = pass.material;
			this.renderer.toneMapping = NoToneMapping;
			this.renderer.outputColorSpace = ColorManagement.workingColorSpace;
			this.renderer.setRenderTarget?.( pass.target );
			this.renderer.setMRT?.( null );
			const started = performance.now();
			const compiling = this.renderer.compileAsync( object, pass.camera, this.scene );
			const held = performance.now() - started;
			if ( held >= NOTED_MS ) this.hitches?.note( `warm-up shadow ${nameOf( object )}`, held );
			await compiling;

		} finally {

			this.scene.overrideMaterial = override;
			pass.shadow.needsUpdate = drawing;
			this.renderer.toneMapping = tone;
			this.renderer.outputColorSpace = space;
			for ( const node of hidden ) node.visible = true;

		}

	}

	/** Decodes and uploads each new map once, asking the budget between uploads. */
	async #upload( object ) {

		const textures = texturesOf( object ).filter( ( { texture } ) => ! this.uploaded.has( texture ) );

		for ( let index = 0; index < textures.length; index ++ ) {

			const { texture, ready } = textures[ index ];
			await Promise.all( ready );
			const started = performance.now();
			this.renderer.initTexture?.( texture );
			const held = performance.now() - started;
			if ( held >= NOTED_MS ) this.hitches?.note( `upload ${texture.name || texture.image?.src?.split( '/' ).at( - 1 ) || 'map'}`, held );
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

/** Whether anything in the object draws into a shadow map. */
function casts( object ) {

	let found = false;
	object.traverse( ( node ) => { found ||= Boolean( node.material && node.castShadow ); } );

	return found;

}

/** What a hitch note calls the object a warm-up prepared: its own name, or its first named mesh's. */
function nameOf( object ) {

	if ( object.name ) return object.name;
	let named = null;
	object.traverse?.( ( node ) => { named ??= node.name || null; } );

	return named ?? object.type ?? 'object';

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
