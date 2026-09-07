import * as THREE from 'three/webgpu';
import { texture, mrt, output, emissive, vec4, screenCoordinate, float } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { bayer16 } from 'three/addons/tsl/math/Bayer.js';

/** One code value of dither, which is all it takes to break an 8-bit ramp. */
const DITHER = 1 / 255;

/**
 * How a frame is put together.
 *
 * Bloom is fed by the emissive attachment rather than by a brightness
 * threshold, and that one choice is most of the look: a neon tube, a lamp lens
 * and a lit window glow, while the wall they light does not. A threshold cannot
 * tell those apart and always ends up blooming the floor.
 *
 * The chain runs on linear HDR values and the tone response is applied once,
 * last, which is what makes bloom read as light rather than as smear. The
 * output transform is placed by hand so a dither can sit after it: the falloffs
 * in this world are huge and soft, and eight bits band across them visibly.
 */
export class LookPipeline {

	constructor( renderer, scene, camera, tier ) {

		this.renderer = renderer;
		this.scene = scene;
		this.camera = camera;
		this.outputToneMapping = renderer.toneMapping;
		this.outputColorSpace = renderer.outputColorSpace;
		this.size = new THREE.Vector2();
		const dither = bayer16( screenCoordinate ).sub( 0.5 ).mul( float( DITHER ) );
		// A tier with no bloom skips the emissive target and the blur chain outright, not a zero-strength pass.
		const blooming = tier.bloom.strength > 0;
		this.renderTarget = new THREE.RenderTarget( 1, 1, {
			type: renderer.getOutputBufferType(), samples: renderer.samples, count: blooming ? 2 : 1
		} );
		this.renderTarget.texture.name = 'output';
		let bloomPass = null;

		// What the scene pass writes, kept so a warm-up can compile against the
		// same outputs the frame will ask for (src/game/look/Warmup.js).
		this.mrt = null;

		if ( blooming ) {

			const mrtNode = mrt( { output, emissive: vec4( emissive, output.a ) } );
			mrtNode.setBlendMode( 'emissive', new THREE.BlendMode( THREE.NormalBlending ) );
			this.renderTarget.textures[ 1 ].name = 'emissive';
			bloomPass = bloom( texture( this.renderTarget.textures[ 1 ] ), tier.bloom.strength, tier.bloom.radius );
			this.mrt = mrtNode;

		}

		this.pipeline = new THREE.RenderPipeline( renderer );
		this.pipeline.outputColorTransform = false;
		const sceneTexture = texture( this.renderTarget.texture );
		const lit = blooming ? sceneTexture.add( bloomPass ) : sceneTexture;
		this.pipeline.outputNode = lit.renderOutput().add( dither );

		this.bloom = bloomPass;

	}

	render() {

		const renderer = this.renderer;
		renderer.getDrawingBufferSize( this.size );
		this.renderTarget.setSize( this.size.x, this.size.y );
		const target = renderer.getRenderTarget();
		const previousMRT = renderer.getMRT();
		const tone = renderer.toneMapping;
		const color = renderer.outputColorSpace;
		try {

			renderer.setRenderTarget( this.renderTarget );
			renderer.setMRT( this.mrt );
			renderer.toneMapping = THREE.NoToneMapping;
			renderer.outputColorSpace = THREE.ColorManagement.workingColorSpace;
			// Scene preparation and drawing share the same top-level render context.
			renderer.render( this.scene, this.camera );
			renderer.setRenderTarget( null );
			renderer.setMRT( null );
			renderer.toneMapping = this.outputToneMapping;
			renderer.outputColorSpace = this.outputColorSpace;
			this.pipeline.render();

		} finally {

			renderer.setRenderTarget( target );
			renderer.setMRT( previousMRT );
			renderer.toneMapping = tone;
			renderer.outputColorSpace = color;

		}

	}

}
