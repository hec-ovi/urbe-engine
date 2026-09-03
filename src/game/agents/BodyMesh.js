import { attribute, float, instancedBufferAttribute, max, mix, smoothstep, step, texture, vec2, vec4 } from 'three/tsl';
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

	/** @param paint { map: skin base colour, eyeMap: eye colour, cloth: garment/eye marker } */
	colorNode( geometry, { map, eyeMap, cloth } ) {

		geometry.setAttribute( 'cloth', cloth );

		// Skin with the sleeve cut, shirt with the hem cut: two vec4s and a
		// vec3 keep the body inside WebGPU's eight vertex buffers.
		this.skins = this.attribute( 4 );
		this.shirts = this.attribute( 4 );
		this.trousers = this.attribute( 3 );

		const aSkinCut = instancedBufferAttribute( this.skins, 'vec4' );
		const aShirtCut = instancedBufferAttribute( this.shirts, 'vec4' );

		return dressedColorNode( geometry, map, {
			skin: aSkinCut.xyz,
			shirt: aShirtCut.xyz,
			trousers: instancedBufferAttribute( this.trousers, 'vec3' ),
			cut: vec2( aSkinCut.w, aShirtCut.w )
		}, eyeMap );

	}

	setLook( slot, look ) {

		this.skins.setXYZW( slot, look.skin.r, look.skin.g, look.skin.b, look.sleeve );
		this.shirts.setXYZW( slot, look.shirt.r, look.shirt.g, look.shirt.b, look.hem );
		this.trousers.setXYZ( slot, look.trousers.r, look.trousers.g, look.trousers.b );

	}

}

/** The same garment surface for a baked crowd body or one focused rig. */
export function dressedColorNode( geometry, map, { skin, shirt, trousers, cut }, eyeMap = null ) {

	const aCloth = attribute( 'cloth', 'vec4' );
	// A limb the garment does not reach carries 2, well past any cut, so
	// these two land on 0 for every vertex that is not on that limb.
	const sleeve = float( 1 ).sub( smoothstep( cut.x.sub( EDGE ), cut.x.add( EDGE ), aCloth.y ) );
	const leg = float( 1 ).sub( smoothstep( cut.y.sub( EDGE ), cut.y.add( EDGE ), aCloth.z ) );
	const torso = smoothstep( TORSO_IN, TORSO_OUT, aCloth.x );
	const bare = texture( map ).rgb.mul( skin );
	const dressed = mix( bare, trousers, leg );
	const top = mix( dressed, shirt, max( torso, sleeve ) );

	const body = mix( top, trousers.mul( SHOE_SHADE ), aCloth.w );
	const surface = eyeMap ? mix( texture( eyeMap ).rgb, body, step( 0, aCloth.x ) ) : body;

	return vec4( surface, 1 );

}
