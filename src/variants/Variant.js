/**
 * One interchangeable way to render the same seeded city.
 *
 * Lifecycle: build(ctx) adds objects to ctx.scene; update(camera) runs before
 * every render (compute passes live here); visibleInstances(info) reads the
 * per-frame visible count from wherever this variant can know it; dispose()
 * removes and frees everything it created.
 *
 * ctx: { scene, renderer, camera, city, archetypes, staticDrawCalls }
 */
export class Variant {

	/** @param {object} ctx */
	async build( ctx ) {

		this.ctx = ctx;

	}

	/** Per-frame, before render. @param {THREE.Camera} camera */
	update( camera ) {} // eslint-disable-line no-unused-vars

	/**
	 * Visible building instances this frame, or null when unknown. A variant
	 * that knows better triangle numbers than renderer.info (indirect draws)
	 * adds a triangles field.
	 * @param {object} info renderer.info after the render
	 * @returns {{ total: number|null, byLod: number[]|null, triangles?: number }}
	 */
	visibleInstances( info ) { // eslint-disable-line no-unused-vars

		return { total: null, byLod: null };

	}

	dispose() {}

}
