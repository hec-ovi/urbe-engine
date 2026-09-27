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

		mesh.material = coveredMaterial( mesh.material, instancedBufferAttribute( attribute, 'float' ) );

	}
	return attribute;

}

/** Preserve every authored surface while giving it the shared coverage. */
export function coveredMaterial( source, node ) {

	const material = source.isNodeMaterial ? source.clone() : Object.assign(
		source.isMeshBasicMaterial ? new THREE.MeshBasicNodeMaterial() : new THREE.MeshStandardNodeMaterial(), source
	);
	return presenceMaterial( material, node );

}

export function stepPresence( value, leaving, delta ) {

	return THREE.MathUtils.clamp( value + ( leaving ? - 1 : 1 ) * delta / ( leaving ? 0.6 : 0.8 ), 0, 1 );

}
