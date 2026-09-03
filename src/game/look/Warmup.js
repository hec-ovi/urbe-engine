/**
 * Every pipeline and map built before the frame that would first draw it.
 *
 * The WebGL2 backend links a program the moment an object first renders, and a
 * link of a city material (a physical surface under batched lights, often with
 * transmission) is tens of milliseconds to seconds of blocked main thread. Its
 * maps upload on the same frame, the whole mip chain, also blocking. That is
 * what a walk across the city feels: a median frame of ten milliseconds and a
 * freeze every time the street shows something it has not shown before.
 *
 * `compileAsync` is the same work on the other path: three passes a promise
 * list to the backend, which then links through KHR_parallel_shader_compile and
 * polls for completion instead of waiting, so nothing blocks. Textures upload
 * during the same pass. Whatever is warmed here never stalls a frame later.
 *
 * What is warmed is hidden or off camera by definition, so the pass turns
 * visibility and frustum culling off for the objects it compiles and puts both
 * back exactly as they were. The compile runs under the render pipeline's own
 * multiple render target, because that decides how many outputs the fragment
 * shader writes and so which program the frame will actually ask for.
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

	}

	/**
	 * @param object anything in the scene graph, in the scene or still detached
	 * @returns milliseconds the warm-up took, or 0 when it could not run
	 */
	async warm( object ) {

		if ( ! object || ! this.renderer?.compileAsync ) return 0;

		const started = performance.now();
		const shown = [];
		const previous = this.renderer.getMRT?.() ?? null;

		object.traverse( ( node ) => {

			shown.push( [ node, node.visible, node.frustumCulled ] );
			node.visible = true;
			node.frustumCulled = false;

		} );

		try {

			this.renderer.setMRT?.( this.mrt );
			await this.renderer.compileAsync( object, this.camera, this.scene );

		} catch ( error ) {

			// A warm-up that fails costs a stutter later, never the run.
			console.warn( `warmup: ${error?.message ?? error}` );

		} finally {

			this.renderer.setMRT?.( previous );
			for ( const [ node, visible, culled ] of shown ) {

				node.visible = visible;
				node.frustumCulled = culled;

			}

		}

		return performance.now() - started;

	}

	/**
	 * Warms one renderable at a time. Large WebGL worlds can make a driver
	 * compile hundreds of programs concurrently when the whole scene is passed
	 * at once; serial work keeps the same cache result without that peak.
	 */
	async warmAll( object ) {

		if ( ! object ) return 0;
		const renderables = [];
		object.traverse( ( node ) => { if ( node.material ) renderables.push( node ); } );
		const started = performance.now();

		for ( let index = 0; index < renderables.length; index ++ ) {

			await this.warm( renderables[ index ] );
			if ( ( index + 1 ) % 8 === 0 ) await taskYield();

		}

		return performance.now() - started;

	}

}

function taskYield() {

	return new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

}
