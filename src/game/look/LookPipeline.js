import * as THREE from 'three/webgpu';
import { pass, mrt, output, emissive, vec4, screenCoordinate, float } from 'three/tsl';
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

		const scenePass = pass( scene, camera );
		const dither = bayer16( screenCoordinate ).sub( 0.5 ).mul( float( DITHER ) );
		// A tier with no bloom skips the emissive target and the blur chain outright, not a zero-strength pass.
		const blooming = tier.bloom.strength > 0;
		let bloomPass = null;

		// What the scene pass writes, kept so a warm-up can compile against the
		// same outputs the frame will ask for (src/game/look/Warmup.js).
		this.mrt = null;

		if ( blooming ) {

			const mrtNode = mrt( { output, emissive: vec4( emissive, output.a ) } );
			mrtNode.setBlendMode( 'emissive', new THREE.BlendMode( THREE.NormalBlending ) );
			scenePass.setMRT( mrtNode );
			bloomPass = bloom( scenePass.getTextureNode( 'emissive' ), tier.bloom.strength, tier.bloom.radius );
			this.mrt = mrtNode;

		}

		this.pipeline = new THREE.RenderPipeline( renderer );
		this.pipeline.outputColorTransform = false;
		const lit = blooming ? scenePass.getTextureNode().add( bloomPass ) : scenePass.getTextureNode();
		this.pipeline.outputNode = lit.renderOutput().add( dither );

		this.bloom = bloomPass;

	}

	render() {

		this.pipeline.render();

	}

}
