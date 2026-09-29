import { instancedBufferAttribute } from 'three/tsl';
import { CrowdMesh } from './CrowdMesh.js';
import { hairNode } from './avatar/Tints.js';

/**
 * Hair and eyebrows: the pack's own hair map in each person's hair colour
 * (Tints.js), the same as their focused body wears it.
 */
export class HairMesh extends CrowdMesh {

	/** @param paint { map: the hair base colour } */
	colorNode( geometry, { map } ) {

		this.hair = this.attribute( 3 );

		return hairNode( map, instancedBufferAttribute( this.hair, 'vec3' ) );

	}

	surface( material ) { material.roughness = 0.96; }

	setLook( slot, look ) {

		this.hair.setXYZ( slot, look.hair.r, look.hair.g, look.hair.b );

	}

}

