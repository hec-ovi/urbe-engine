/**
 * Builds WebGPU pipelines and maps before a frame first draws them.
 *
 * Hidden or off-camera objects are staged for compilation and restored exactly.
 * The compile uses the render pipeline's multiple render target because that
 * decides which fragment program the visible frame requests.
 */
export class Warmup {

	/**
	 * @param scene the scene the object lives in or is going to, for its lights
	 * @param mrt the render pipeline's scene-pass MRT, or null when it has none
	 */
	constructor( renderer, scene, camera, mrt = null ) {

		this.renderer = renderer;
		this.scene = scene;
		this.camera = camera;
		this.mrt = mrt;
		this.uploaded = new WeakSet();

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

		if ( ! object || ! this.renderer?.compileAsync ) return;
		let shown = null;
		let previous;

		try {

			await this.#upload( object );
			shown = stage( object );
			previous = this.renderer.getMRT?.() ?? null;
			this.renderer.setMRT?.( this.mrt );
			await this.renderer.compileAsync( object, this.camera, this.scene );

		} finally {

			if ( shown ) {

				this.renderer.setMRT?.( previous );
				restore( shown );

			}

		}

	}

	/** Decodes and uploads each new map once, yielding between individual uploads. */
	async #upload( object ) {

		if ( ! this.renderer?.initTexture ) return;

		const textures = texturesOf( object ).filter( ( texture ) => ! this.uploaded.has( texture ) );

		for ( let index = 0; index < textures.length; index ++ ) {

			const texture = textures[ index ];
			await texture[ Symbol.for( 'urbe.texture-ready' ) ];
			this.renderer.initTexture( texture );
			this.uploaded.add( texture );
			await frameYield();

		}

	}

	/**
	 * Warms one renderable at a time so the backend never receives an unbounded
	 * set of programs in one compile request.
	 */
	async warmAll( object, { wanted = () => true } = {} ) {

		if ( ! object ) return 0;
		const renderables = [];
		object.traverse( ( node ) => { if ( node.material ) renderables.push( node ); } );
		const started = performance.now();

		for ( let index = 0; index < renderables.length; index ++ ) {

			if ( ! wanted() ) break;
			await this.#prepare( renderables[ index ] );
			if ( index + 1 < renderables.length ) await frameYield();

		}

		return performance.now() - started;

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

function frameYield() {

	return new Promise( ( resolve ) => {

		if ( globalThis.requestAnimationFrame ) requestAnimationFrame( resolve );
		else setTimeout( resolve, 0 );

	} );

}

/** Unique textures reached directly from every material in one object tree. */
function texturesOf( object ) {

	const textures = new Set();

	object.traverse( ( node ) => {

		const materials = Array.isArray( node.material ) ? node.material : [ node.material ];

		for ( const material of materials ) {

			if ( ! material ) continue;
			for ( const value of Object.values( material ) ) if ( value?.isTexture ) textures.add( value );

		}

	} );

	return [ ...textures ];

}
