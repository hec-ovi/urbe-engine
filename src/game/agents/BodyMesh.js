import { instancedBufferAttribute } from 'three/tsl';
import { dressSurface } from './Fabric.js';
import { CrowdMesh } from './CrowdMesh.js';
import { clothShare, crowdGarments, packLook, paintedColorNode } from './CrowdLook.js';

/**
 * A dressed crowd body. The bodies are baked undressed, so each person's
 * recipe is painted on: the garment map (Garments.js) says what drives each
 * vertex and the rest pose how high it is and how far out along the arm, and
 * every person carries their own skin, top, trousers and footwear colours, the
 * top's second colour and where each garment ends, cut as the garment's own
 * pattern cuts it (CrowdLook.js). Nothing is added to the mesh, so a whole
 * city of people still costs one draw call per model.
 */
export class BodyMesh extends CrowdMesh {

	/**
	 * @param paint `{ map: skin base colour, eyeMap: eye colour, cloth: garment/eye
	 *   marker, height, bottom: the rest body's height and lowest point }`
	 */
	colorNode( geometry, { map, eyeMap, cloth, height, bottom } ) {

		geometry.setAttribute( 'cloth', cloth );

		// Three vec4s keep the body inside WebGPU's eight vertex buffers: each
		// colour's fourth lane carries packed cuts or a second colour.
		this.skins = this.attribute( 4 );
		this.shirts = this.attribute( 4 );
		this.trousers = this.attribute( 4 );

		const aSkin = instancedBufferAttribute( this.skins, 'vec4' );
		const aShirt = instancedBufferAttribute( this.shirts, 'vec4' );
		const aTrousers = instancedBufferAttribute( this.trousers, 'vec4' );
		this.garments = crowdGarments( { cuts: aSkin.w, figure: this.figure }, { height, bottom } );

		return paintedColorNode( map, {
			skin: aSkin.xyz, shirt: aShirt.xyz, trousers: aTrousers.xyz, shoes: aShirt.w, panel: aTrousers.w
		}, this.garments, eyeMap );

	}

	surface( material ) { dressSurface( material, clothShare( this.garments ), material.normalNode ); }

	setLook( slot, look ) {

		const pack = packLook( look );
		this.skins.setXYZW( slot, look.skin.r, look.skin.g, look.skin.b, pack.cuts );
		this.shirts.setXYZW( slot, look.shirt.r, look.shirt.g, look.shirt.b, pack.shoes );
		this.trousers.setXYZW( slot, look.trousers.r, look.trousers.g, look.trousers.b, pack.panel );

	}

}
