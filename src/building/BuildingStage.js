import * as THREE from 'three/webgpu';
import { FlyCamera } from './FlyCamera.js';

/**
 * Stage for one building: neutral sky, sun and fill lights, ground plane,
 * orbit camera framed on the building's bounding box.
 */
export class BuildingStage {

	static build( boundingBox, domElement ) {

		const size = boundingBox.getSize( new THREE.Vector3() );
		const center = boundingBox.getCenter( new THREE.Vector3() );
		const radius = Math.max( size.x, size.y, size.z );

		const scene = new THREE.Scene();
		scene.background = new THREE.Color( 0x1a1d24 );

		const sun = new THREE.DirectionalLight( 0xffffff, 2.4 );
		sun.position.set( center.x + radius, boundingBox.max.y + radius, center.z + radius * 0.6 );
		scene.add( sun );

		const fill = new THREE.DirectionalLight( 0xbcc8ff, 0.7 );
		fill.position.set( center.x - radius, boundingBox.max.y * 0.5, center.z - radius );
		scene.add( fill );
		scene.add( new THREE.AmbientLight( 0xffffff, 0.55 ) );

		const ground = new THREE.Mesh(
			new THREE.PlaneGeometry( radius * 8, radius * 8 ),
			new THREE.MeshStandardMaterial( { color: 0x2c3036, roughness: 1, metalness: 0 } )
		);
		ground.rotation.x = - Math.PI / 2;
		ground.position.set( center.x, - 0.01, center.z );
		scene.add( ground );

		const camera = new THREE.PerspectiveCamera(
			50, window.innerWidth / window.innerHeight, 0.1, radius * 40
		);
		camera.position.set( center.x + radius * 1.4, boundingBox.max.y * 1.1, center.z + radius * 1.4 );

		const controls = new FlyCamera( camera, domElement );
		controls.lookAt( center );

		return { scene, camera, controls };

	}

}
