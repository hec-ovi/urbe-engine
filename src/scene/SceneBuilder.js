import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Fixed stage shared by every variant: sky-colored scene, lights, ground
 * plane, orbit camera framing the city. Draw calls owned by the stage are
 * reported so variants' own visibility numbers can exclude them.
 */
export class SceneBuilder {

	/**
	 * @param {number} halfExtent city half extent in metres
	 * @param {HTMLElement} domElement renderer canvas, for the controls
	 */
	static build( halfExtent, domElement ) {

		const scene = new THREE.Scene();
		scene.background = new THREE.Color( 0xbfd3e0 );
		scene.fog = new THREE.Fog( 0xbfd3e0, halfExtent * 1.5, halfExtent * 5 );

		const sun = new THREE.DirectionalLight( 0xffffff, 2.2 );
		sun.position.set( 0.6, 1, 0.35 );
		scene.add( sun );
		scene.add( new THREE.AmbientLight( 0xdfe8f0, 0.9 ) );

		const ground = new THREE.Mesh(
			new THREE.PlaneGeometry( halfExtent * 4, halfExtent * 4 ),
			new THREE.MeshLambertMaterial( { color: 0x3c4046 } )
		);
		ground.rotation.x = - Math.PI / 2;
		scene.add( ground );

		const camera = new THREE.PerspectiveCamera(
			55, window.innerWidth / window.innerHeight, 1, halfExtent * 10
		);
		camera.position.set( halfExtent * 0.9, halfExtent * 0.55, halfExtent * 0.9 );

		const controls = new OrbitControls( camera, domElement );
		controls.target.set( 0, 20, 0 );
		controls.maxDistance = halfExtent * 4;
		controls.update();

		return { scene, camera, controls, staticDrawCalls: 1 };

	}

}
