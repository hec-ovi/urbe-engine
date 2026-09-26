import { instancedBufferAttribute, texture, vec4 } from 'three/tsl';
import { CrowdMesh } from './CrowdMesh.js';

/**
 * Hair and eyebrows: the pack's own hair map, tinted per person, so a street
 * is not one haircut in one colour.
 */
export class HairMesh extends CrowdMesh {

	/** @param paint { map: the hair base colour } */
	colorNode( geometry, { map } ) {

		this.hair = this.attribute( 3 );

		return hairColorNode( map, instancedBufferAttribute( this.hair, 'vec3' ) );

	}

	setLook( slot, look ) {

		this.hair.setXYZ( slot, look.hair.r, look.hair.g, look.hair.b );

	}

}

/** The same tinted hair for the baked crowd and for one focused rig's hairstyle and eyebrows. */
export function hairColorNode( map, tint ) {

	return vec4( texture( map ).rgb.mul( tint ), 1 );

}
