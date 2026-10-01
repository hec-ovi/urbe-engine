import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { ReachedPointLightDataNode } from './LightReach.js';

/** A camera at the origin looking down -Z, 90 degrees wide, 1 to 100 m. */
function camera() {

	const view = new THREE.PerspectiveCamera( 90, 1, 1, 100 );
	view.updateMatrixWorld();
	view.updateProjectionMatrix();

	return view;

}

function light( x, y, z, { distance = 5, intensity = 1, color = 0xffffff, decay = 2 } = {} ) {

	const point = new THREE.PointLight( color, intensity, distance, decay );
	point.position.set( x, y, z );
	point.updateMatrixWorld();

	return point;

}

describe( 'the batched point lights a frame hands its fragments', () => {

	it( 'keeps only lit lights whose reach touches what the camera sees, with the values three writes for them', () => {

		const node = new ReachedPointLightDataNode( 8 );
		const ahead = light( 0, 0, - 20, { intensity: 3, color: 0xff8000, distance: 6, decay: 1.5 } );
		const behind = light( 0, 0, 20 );
		// Its centre is behind the camera, its reach crosses into the view.
		const straddling = light( 0, 0, 3, { distance: 10 } );
		const dark = light( 0, 0, - 10, { intensity: 0 } );
		const black = light( 0, 0, - 10, { color: 0x000000 } );
		// A cutoff of zero is a light with no end: it reaches the whole view.
		const endless = light( 0, 0, 500, { distance: 0 } );
		node.setLights( [ behind, ahead, dark, straddling, black, endless ] );

		node.update( { camera: camera() } );

		expect( node.countNode.value ).toBe( 3 );
		const kept = [ ahead, straddling, endless ];
		kept.forEach( ( one, index ) => {

			const color = one.color.clone().multiplyScalar( one.intensity );
			expect( node._colors[ index ].equals( color ) ).toBe( true );
			const at = new THREE.Vector3().setFromMatrixPosition( one.matrixWorld );
			expect( node._positionsAndCutoff[ index ].toArray() ).toEqual( [ at.x, at.y, at.z, one.distance ] );
			expect( node._decays[ index ].x ).toBe( one.decay );

		} );

	} );

	it( 'never hands more than its slots, and leaves out a light past the far plane', () => {

		const node = new ReachedPointLightDataNode( 2 );
		node.setLights( [ light( 0, 0, - 200 ), light( 0, 0, - 5 ), light( 1, 0, - 5 ), light( 2, 0, - 5 ) ] );
		node.update( { camera: camera() } );
		expect( node.countNode.value ).toBe( 2 );
		expect( node._positionsAndCutoff[ 0 ].z ).toBe( - 5 );

	} );

} );
