import * as THREE from 'three/webgpu';

const NEAR = 1;
const FAR = 320;
/** Milliseconds between bakes, whatever asks for one. */
const COOLDOWN = 2000;
const FACES = 6;

/**
 * What the shiny things in the world reflect.
 *
 * Wet asphalt and glass carry the street's neon down the road as long smears,
 * and a probe baked from the sky alone has none of that in it. So the probe is
 * baked from the scene itself at the point the player is standing, and rebaked
 * once they have walked far enough for the neighbourhood to have changed. It
 * is also the second half of the shadow floor: an environment probe lifts the
 * darks the way air does, view-dependently, where a flat ambient reads as a
 * wash immediately.
 *
 * A bake is six renders of the city and a mip convolution. Only the loading
 * bake does them in one go: a rebake renders one cube face per frame and
 * convolves on the seventh, so no single frame carries the whole city twice,
 * and the reflections in use stay the previous bake's until the new one is
 * whole.
 */
export class EnvironmentProbe {

	/**
	 * @param tier quality descriptor (probeSize, probeInterval in metres)
	 * @param convolve turns the rendered cube into the prefiltered environment; the PMREM generator unless a test says otherwise
	 */
	constructor( renderer, scene, tier, hitches = null, convolve = pmrem ) {

		this.renderer = renderer;
		this.hitches = hitches;
		this.scene = scene;
		this.size = tier.probeSize;
		this.interval = tier.probeInterval;
		this.convolve = convolve;
		this.at = null;
		this.target = null;
		this.last = - Infinity;
		this.pending = false;
		this.excluded = [];
		this.cube = new THREE.CubeRenderTarget( this.size, { type: THREE.HalfFloatType } );
		this.camera = new THREE.CubeCamera( NEAR, FAR, this.cube );
		this.face = FACES;

	}

	/**
	 * Groups left out of the six probe renders: what a rough wall reflects is
	 * the lit city around it, not the crowd, the cars or the furniture, and
	 * those are most of the draw calls a bake would otherwise submit.
	 */
	exclude( ...groups ) {

		this.excluded.push( ...groups );

	}

	/** Whether a bake is under way, faces still to render. */
	get baking() {

		return this.face < FACES;

	}

	/** The whole bake now: the loading screen's, before the first frame. */
	bake( position, now = performance.now() ) {

		this.#begin( position, now );
		while ( this.baking ) this.#step();

	}

	/** @param still whether the player has stood still for the last stretch: a bake never starts mid-stride */
	update( position, still ) {

		if ( this.baking ) {

			this.#step();
			return;

		}

		if ( ! this.at || ! still ) return;

		if ( this.at.distanceTo( position ) > this.interval ) this.pending = true;

		if ( ! this.pending ) return;

		const now = performance.now();

		if ( now - this.last < COOLDOWN ) return;

		this.pending = false;
		this.#begin( position, now );

	}

	#begin( position, now ) {

		this.last = now;
		this.at = position.clone();
		this.face = 0;
		this.camera.position.copy( position );
		this.camera.updateMatrixWorld();

		if ( this.camera.coordinateSystem !== this.renderer.coordinateSystem ) {

			this.camera.coordinateSystem = this.renderer.coordinateSystem;
			this.camera.updateCoordinateSystem();

		}

	}

	/** One cube face, the city rendered without the excluded groups; the sixth face ends with the convolution. */
	#step() {

		const t = performance.now();
		const renderer = this.renderer;
		const shown = this.excluded.filter( ( group ) => group.visible );
		const current = renderer.getRenderTarget();
		const xr = renderer.xr.enabled;

		for ( const group of shown ) group.visible = false;
		renderer.xr.enabled = false;
		this.cube.texture.generateMipmaps = false;
		renderer.setRenderTarget( this.cube, this.face, 0 );
		if ( renderer.reversedDepthBuffer && renderer.autoClear === false ) renderer.clearDepth();
		renderer.render( this.scene, this.camera.children[ this.face ] );
		renderer.setRenderTarget( current );
		renderer.xr.enabled = xr;
		for ( const group of shown ) group.visible = true;

		this.face ++;
		if ( ! this.baking ) this.#finish();
		this.hitches?.note( this.baking ? `probe face ${this.face}` : 'probe convolve', performance.now() - t );

	}

	#finish() {

		const previous = this.target;
		this.target = this.convolve( this.renderer, this.cube.texture );
		this.scene.environment = this.target.texture;
		previous?.dispose();

	}

}

/** The prefiltered environment from a rendered cube. */
function pmrem( renderer, cubemap ) {

	const generator = new THREE.PMREMGenerator( renderer );
	const target = generator.fromCubemap( cubemap );
	generator.dispose();
	return target;

}
