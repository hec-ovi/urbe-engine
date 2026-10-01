import * as THREE from 'three/webgpu';
import { min, texture, uv, vec4 } from 'three/tsl';

const NEAR = 1;
const FAR = 320;
/**
 * The brightest radiance a probe face keeps, in cd/m2. Its targets are half
 * floats: a daylight face (the sky, the sun's highlights) can pass their 65504
 * ceiling, and one infinite texel turns the whole convolution into NaN, which
 * every material then shades black. Capped well below, a sunlit city still
 * reflects as bright as it looks.
 */
export const PROBE_LIMIT = 30000;

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
 * A bake is six renders of the city and a mip convolution. The loading bake
 * does them under the load's budget, one face per ask; a rebake renders one
 * cube face per frame and convolves on the seventh, so no single frame
 * carries the whole city twice, and the reflections in use stay the previous
 * bake's until the new one is whole.
 *
 * The environment the scene reflects is one resident texture, standing from
 * the moment the probe is built: black until the first bake, and every bake
 * after writes into it. A material's program is built for the environment it
 * has, so one that changed identity would have every program built again.
 *
 * While it shares the frame's scene pass (`share`), a face is drawn with the
 * frame's outputs into a square target made like the frame's own (the same
 * attachments, format, type and samples), then copied into the cube by one
 * small quad. The renderer keeps a graph and a pipeline per material and
 * render context, and a context is those attachments and outputs, so a face
 * drawn that way asks for nothing the frame has not already built: there is
 * no second set of graphs to prepare, and a bake costs its six draws. It is
 * multisampled as the frame is, though, so a thin and very bright fixture (a
 * lamp's lens seen edge on) reads at its coverage there and at full strength
 * in a face of its own; a game bakes that way to open, then prepares the
 * faces' own graphs and goes back to them (`unshare`). Without a frame to
 * share, a face renders straight into the cube with graphs of its own.
 */
export class EnvironmentProbe {

	/**
	 * @param tier quality descriptor (probeSize, probeInterval in metres)
	 * @param convolve turns the rendered cube into the prefiltered environment; the PMREM generator unless a test says otherwise
	 */
	constructor( renderer, scene, tier, hitches = null, convolve = null ) {

		this.renderer = renderer;
		this.hitches = hitches;
		this.scene = scene;
		this.size = tier.probeSize;
		this.interval = tier.probeInterval;
		this.generator = convolve ? null : new THREE.PMREMGenerator( renderer );
		this.convolve = convolve ?? ( ( renderer, texture, target ) => this.generator.fromCubemap( texture, target ) );
		this.at = null;
		this.target = null;
		this.last = - Infinity;
		this.pending = false;
		this.excluded = [];
		this.cube = new THREE.CubeRenderTarget( this.size, { type: THREE.HalfFloatType } );
		this.camera = new THREE.CubeCamera( NEAR, FAR, this.cube );
		this.face = FACES;
		this.frame = null;
		this.#prime();

	}

	/**
	 * Draws the faces in the frame's render context from now on.
	 * @param frame the LookPipeline: its `renderTarget`, whose make the faces' target copies, and `mrt`
	 */
	share( frame ) {

		const made = frame.renderTarget;
		this.frame = frame;
		this.face2d = new THREE.RenderTarget( this.size, this.size, {
			type: made.texture.type, format: made.texture.format, samples: made.samples, count: made.textures.length,
			depthBuffer: made.depthBuffer, stencilBuffer: made.stencilBuffer
		} );
		this.face2d.texture.name = 'probe face';
		const material = new THREE.NodeMaterial();
		material.name = 'probe face copy';
		material.fragmentNode = min( texture( this.face2d.texture, uv() ), vec4( PROBE_LIMIT ) );
		material.depthTest = false;
		material.depthWrite = false;
		this.copy = new THREE.QuadMesh( material );

	}

	/** The resident environment, from an empty cube, before anything is compiled against it. */
	#prime() {

		const renderer = this.renderer;
		const current = renderer.getRenderTarget();
		try {

			for ( let face = 0; face < FACES; face ++ ) {

				renderer.setRenderTarget( this.cube, face, 0 );
				renderer.clear?.();

			}

		} finally {

			renderer.setRenderTarget( current );

		}
		this.#finish();

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

	/** The whole bake now, in one go: for a preview whose frame is not yet drawn. */
	bake( position, now = performance.now() ) {

		this.#begin( position, now );
		while ( this.baking ) this.#step();

	}

	/**
	 * The loading bake: one face per ask of the frame budget, each counted.
	 * @param onProgress receives (faces done, faces)
	 */
	async bakeAsync( position, { slice = null, onProgress = () => {} } = {}, now = performance.now() ) {

		this.#begin( position, now );
		let done = 0;
		while ( this.baking ) {

			if ( slice ) await slice.step();
			this.#step();
			onProgress( ++ done, FACES );

		}

	}

	/**
	 * Builds the graphs the cube faces draw with, one per program, before a
	 * face renders them all in one go. Faces drawn through the frame's scene
	 * pass need none: the frame's are theirs, and the copy's one small program
	 * builds with the first face. Faces drawn straight into the cube do, since
	 * the renderer keeps a graph per render target; the excluded groups are
	 * left out, as they are of the faces.
	 *
	 * @param warmup the frame's `Warmup`, whose uploads, pins and queue this shares
	 * @param onProgress receives (done, total) over the graphs
	 * @param own build the faces' own graphs even while they are drawn through the frame's, for `unshare`
	 * @param budget what the graphs ask between them, when not the warm-up's own
	 */
	prepare( warmup, onProgress = () => {}, { own = false, budget } = {} ) {

		if ( this.frame && ! own ) return Promise.resolve( 0 );

		return warmup.sibling( { camera: this.camera.children[ 0 ], renderTarget: this.cube, mrt: null, ...( budget ? { budget } : {} ) } )
			.warmAll( this.scene, { onProgress, skip: ( node ) => this.excluded.includes( node ) } );

	}

	/** Draws the faces straight into the cube from now on, with the graphs `prepare({ own: true })` built. */
	unshare() {

		if ( ! this.frame ) return;
		this.frame = null;
		this.face2d.dispose();
		this.copy.material.dispose();

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

		const previousMRT = renderer.getMRT();
		const tone = renderer.toneMapping, color = renderer.outputColorSpace;
		try {

			for ( const group of shown ) group.visible = false;
			renderer.xr.enabled = false;
			this.cube.texture.generateMipmaps = false;
			renderer.toneMapping = THREE.NoToneMapping;
			renderer.outputColorSpace = THREE.ColorManagement.workingColorSpace;
			if ( this.frame ) this.#drawThrough( this.camera.children[ this.face ] );
			else {

				renderer.setRenderTarget( this.cube, this.face, 0 );
				renderer.setMRT( null );
				if ( renderer.reversedDepthBuffer && renderer.autoClear === false ) renderer.clearDepth();
				renderer.render( this.scene, this.camera.children[ this.face ] );

			}
			this.face ++;
			if ( ! this.baking ) this.#finish();

		} finally {

			renderer.setRenderTarget( current );
			renderer.setMRT( previousMRT );
			renderer.toneMapping = tone; renderer.outputColorSpace = color;
			renderer.xr.enabled = xr;
			for ( const group of shown ) group.visible = true;

		}

		this.hitches?.note( this.baking ? `probe face ${this.face}` : 'probe convolve', performance.now() - t );

	}

	/** One face drawn in the frame's render context, then copied into the cube. */
	#drawThrough( camera ) {

		const renderer = this.renderer;
		renderer.setRenderTarget( this.face2d );
		renderer.setMRT( this.frame.mrt );
		if ( renderer.autoClear === false ) renderer.clear();
		renderer.render( this.scene, camera );
		renderer.setRenderTarget( this.cube, this.face, 0 );
		renderer.setMRT( null );
		this.copy.render( renderer );

	}

	#finish() {

		const renderer = this.renderer;
		const previousMRT = renderer.getMRT();
		const tone = renderer.toneMapping, color = renderer.outputColorSpace;
		const previous = this.target;
		try {

			renderer.setMRT( null );
			renderer.toneMapping = THREE.NoToneMapping;
			renderer.outputColorSpace = THREE.ColorManagement.workingColorSpace;
			this.target = this.convolve( renderer, this.cube.texture, previous );

		} finally {

			renderer.setMRT( previousMRT );
			renderer.toneMapping = tone; renderer.outputColorSpace = color;

		}
		this.scene.environment = this.target.texture;
		if ( previous && previous !== this.target ) previous.dispose();

	}

}
