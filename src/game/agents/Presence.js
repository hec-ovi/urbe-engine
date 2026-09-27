import * as THREE from 'three/webgpu';
import { instancedBufferAttribute, varying, screenCoordinate } from 'three/tsl';
import { bayer16 } from 'three/addons/tsl/math/Bayer.js';

/** Opaque stochastic coverage also used by Three's depth and shadow passes. */
export function presenceMaterial( material, node ) {

	const mask = varying( node ).greaterThan( bayer16( screenCoordinate ) );
	material.maskNode = material.maskNode ? material.maskNode.and( mask ) : mask;
	material.maskShadowNode = material.maskNode;
	return material;

}

/** One coverage buffer shared by every part of an instanced vehicle. */
export function vehiclePresence( meshes, capacity ) {

	const attribute = new THREE.InstancedBufferAttribute( new Float32Array( capacity ).fill( 1 ), 1 );
	attribute.setUsage( THREE.DynamicDrawUsage );
	for ( const mesh of meshes.filter( Boolean ) ) {

		const source = mesh.material;
		const material = source.isNodeMaterial ? source.clone() : Object.assign(
			source.isMeshBasicMaterial ? new THREE.MeshBasicNodeMaterial() : new THREE.MeshStandardNodeMaterial(), source
		);
		mesh.material = presenceMaterial( material, instancedBufferAttribute( attribute, 'float' ) );

	}
	return attribute;

}

export function stepPresence( value, leaving, delta ) {

	return THREE.MathUtils.clamp( value + ( leaving ? - 1 : 1 ) * delta / ( leaving ? 0.6 : 0.8 ), 0, 1 );

}
