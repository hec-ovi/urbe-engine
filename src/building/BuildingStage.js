import * as THREE from 'three/webgpu';
import { LOOK } from '../game/look/LookSettings.js';
import { FlyCamera } from './FlyCamera.js';

/** What the building stands on while it is inspected, in place of the street. */
const GROUND_COLOR = 0x2c3036;

/**
 * The stage one building stands on: the ground under it and the camera framing
 * it. The night itself - exposure, the sky and its key light, the air and the
 * probe - comes from the shared look installer (game/look/NightLook.js), so a
 * facade is lit here exactly as it is lit in the city.
 */
export class BuildingStage {

	/** @param facing which way the building's entrance looks, when it has one */
	static build( boundingBox, domElement, { facing = null, onLockChange = null } = {} ) {

		const size = boundingBox.getSize( new THREE.Vector3() );
		const center = boundingBox.getCenter( new THREE.Vector3() );

		const scene = new THREE.Scene();

		// Wider than the camera can see, so the air ends the ground rather than
		// an edge does.
		const ground = new THREE.Mesh(
			new THREE.PlaneGeometry( LOOK.far * 3, LOOK.far * 3 ),
			new THREE.MeshStandardMaterial( { color: GROUND_COLOR, roughness: 1, metalness: 0 } )
		);
		ground.rotation.x = - Math.PI / 2;
		ground.position.set( center.x, - 0.01, center.z );
		scene.add( ground );

		// The gameplay camera's own frame, so panel rhythm, window proportion
		// and tiled detail read at the scale they read at in the game.
		const aspect = window.innerWidth / window.innerHeight;
		const camera = new THREE.PerspectiveCamera( LOOK.fov, aspect, LOOK.near, LOOK.far );
		// Off the corner of the face the entrance looks out of, at a quarter of
		// the building's height: that is the side the street lights, and a
		// facade is judged from in front of it rather than from above its roof.
		const standoff = fitDistance( size, aspect, LOOK.fov );
		const view = quarterTurn( facing ?? new THREE.Vector3( 1, 0, 1 ).normalize() );
		camera.position.set(
			center.x + view.x * standoff, center.y + size.y * 0.25, center.z + view.z * standoff
		);

		const controls = new FlyCamera( camera, domElement, onLockChange );
		controls.lookAt( center );

		return { scene, camera, controls };

	}

}

/** Swung a quarter turn off dead ahead, so the frame carries two faces. */
function quarterTurn( direction ) {

	const turn = Math.PI / 8;

	return new THREE.Vector3(
		direction.x * Math.cos( turn ) - direction.z * Math.sin( turn ),
		0,
		direction.x * Math.sin( turn ) + direction.z * Math.cos( turn )
	).normalize();

}

/** How far back the whole building fits the narrower of the two frame angles. */
function fitDistance( size, aspect, fov ) {

	const sphere = 0.5 * Math.hypot( size.x, size.y, size.z );
	const vertical = THREE.MathUtils.degToRad( fov );
	const horizontal = 2 * Math.atan( Math.tan( vertical / 2 ) * aspect );

	return sphere / Math.sin( Math.min( vertical, horizontal ) / 2 ) * 1.05;

}
