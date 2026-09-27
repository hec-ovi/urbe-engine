import * as THREE from 'three/webgpu';
import { attribute, positionLocal, time, vec3 } from 'three/tsl';

/** One short-streak draw around the camera, animated entirely on the GPU. */
export class Rain {

	constructor( count ) {

		const positions = new Float32Array( count * 6 );
		const origins = new Float32Array( count * 6 );
		for ( let index = 0; index < count; index ++ ) {

			const x = random( index * 3 ) * 48 - 24;
			const y = random( index * 3 + 1 ) * 18;
			const z = random( index * 3 + 2 ) * 48 - 24;
			origins.set( [ x, y, z, x, y, z ], index * 6 );
			positions.set( [ 0, 0, 0, 0.025, - 0.38, 0.01 ], index * 6 );

		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
		geometry.setAttribute( 'rainOrigin', new THREE.BufferAttribute( origins, 3 ) );
		const origin = attribute( 'rainOrigin', 'vec3' );
		const material = new THREE.LineBasicNodeMaterial( { color: 0x607986, transparent: true, opacity: 0.15, depthWrite: false } );
		material.positionNode = vec3( origin.x, origin.y.sub( time.mul( 11 ) ).mod( 18 ), origin.z ).add( positionLocal );
		this.mesh = new THREE.LineSegments( geometry, material );
		this.mesh.name = 'rain';
		this.mesh.frustumCulled = false;

	}

	update( camera, sheltered ) {

		this.mesh.visible = ! sheltered;
		this.mesh.position.set( camera.position.x, camera.position.y - 6, camera.position.z );

	}

}

function random( index ) {

	let hash = Math.imul( index + 1, 0x45d9f3b );
	hash = Math.imul( hash ^ hash >>> 16, 0x45d9f3b );
	return ( ( hash ^ hash >>> 16 ) >>> 0 ) / 4294967296;

}
