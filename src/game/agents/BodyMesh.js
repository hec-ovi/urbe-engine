import { attribute, float, instancedBufferAttribute, max, mix, smoothstep, texture, vec2, vec4 } from 'three/tsl';
import { CrowdMesh } from './CrowdMesh.js';

/** How wide a hem or a cuff fades, in limb-length units: about two centimetres. */
const EDGE = 0.04;
/**
 * Where a shirt starts and stops covering the torso, in share of the vertex the
 * spine drives. Bone weights taper over a third of the body, so used raw they
 * smear the shirt into the trousers over 40 cm of blend and the whole figure
 * reads as bare skin under a wash of colour. Thresholded, the garment gets a
 * collar and a waistline.
 */
const TORSO_IN = 0.2;
const TORSO_OUT = 0.48;
/** Shoes are the trousers again, several stops down. */
const SHOE_SHADE = 0.42;

/**
 * A dressed crowd body. The base characters ship undressed, so the clothes are
 * painted on: the garment map (Garments.js) says which part of the body each
 * vertex belongs to, and every person carries their own skin tone, shirt and
 * trousers plus where their sleeves and their hems end. Nothing is added to the
 * mesh, so a whole city of people still costs one draw call per model.
 */
export class BodyMesh extends CrowdMesh {

	/** @param paint { map: skin base colour, cloth: the garment attribute } */
	colorNode( geometry, { map, cloth } ) {

		geometry.setAttribute( 'cloth', cloth );

		// Skin with the sleeve cut, shirt with the hem cut: two vec4s and a
		// vec3 keep the body inside WebGPU's eight vertex buffers.
		this.skins = this.attribute( 4 );
		this.shirts = this.attribute( 4 );
		this.trousers = this.attribute( 3 );

		const aCloth = attribute( 'cloth', 'vec4' );
		const aSkinCut = instancedBufferAttribute( this.skins, 'vec4' );
		const aShirtCut = instancedBufferAttribute( this.shirts, 'vec4' );
		const aSkin = aSkinCut.xyz;
		const aShirt = aShirtCut.xyz;
		const aTrousers = instancedBufferAttribute( this.trousers, 'vec3' );
		const aCut = vec2( aSkinCut.w, aShirtCut.w );

		// A limb the garment does not reach carries 2, well past any cut, so
		// these two land on 0 for every vertex that is not on that limb.
		const sleeve = float( 1 ).sub( smoothstep( aCut.x.sub( EDGE ), aCut.x.add( EDGE ), aCloth.y ) );
		const leg = float( 1 ).sub( smoothstep( aCut.y.sub( EDGE ), aCut.y.add( EDGE ), aCloth.z ) );

		const torso = smoothstep( TORSO_IN, TORSO_OUT, aCloth.x );
		const skin = texture( map ).rgb.mul( aSkin );
		// Trousers first, then the shirt over the waistband, then the shoes.
		const dressed = mix( skin, aTrousers, leg );
		const top = mix( dressed, aShirt, max( torso, sleeve ) );

		return vec4( mix( top, aTrousers.mul( SHOE_SHADE ), aCloth.w ), 1 );

	}

	setLook( slot, look ) {

		this.skins.setXYZW( slot, look.skin.r, look.skin.g, look.skin.b, look.sleeve );
		this.shirts.setXYZW( slot, look.shirt.r, look.shirt.g, look.shirt.b, look.hem );
		this.trousers.setXYZ( slot, look.trousers.r, look.trousers.g, look.trousers.b );

	}

}
