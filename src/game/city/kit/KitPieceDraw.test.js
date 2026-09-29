import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { KitPieceDraw } from './KitPieceDraw.js';

/** What a pass's frustum test answers for each surface of the draw. */
function seen( draw, camera ) {

	const frustum = new THREE.Frustum().setFromProjectionMatrix( new THREE.Matrix4().multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse ) );
	return draw.meshes.map( ( mesh ) => frustum.intersectsObject( mesh ) );

}

describe( 'a furniture draw', () => {

	it( 'is frustum tested around the copies it holds, as they come and go', () => {

		const material = new THREE.MeshStandardMaterial();
		const draw = new KitPieceDraw( 'furniture:test', [
			{ bucket: 0, geometry: new THREE.BoxGeometry( 1, 1, 1 ), material },
			{ bucket: 1, geometry: new THREE.BoxGeometry( 0.2, 2, 0.2 ), material }
		] );
		const camera = new THREE.PerspectiveCamera( 70, 1, 0.2, 900 );
		camera.updateMatrixWorld();
		const at = ( x, z ) => new THREE.Matrix4().makeTranslation( x, 0, z );

		expect( draw.meshes.every( ( mesh ) => mesh.frustumCulled ) ).toBe( true );

		// Behind the camera: the pass leaves the whole draw out.
		const behind = draw.add( at( 0, 30 ), new THREE.Color(), { slot: - 1 } );
		expect( seen( draw, camera ) ).toEqual( [ false, false ] );

		// A copy in front brings it back, whichever copy that is.
		const ahead = draw.add( at( 2, - 30 ), new THREE.Color(), { slot: - 1 } );
		expect( seen( draw, camera ) ).toEqual( [ true, true ] );

		// Taking it away again, the last copy moving into its slot, leaves it out again.
		draw.remove( ahead );
		expect( draw.count ).toBe( 1 );
		expect( seen( draw, camera ) ).toEqual( [ false, false ] );
		draw.remove( behind );
		expect( draw.count ).toBe( 0 );

		// A draw that grew moves to new meshes, tested the same way.
		for ( let i = 0; i < 70; i ++ ) draw.add( at( i, 40 ), new THREE.Color(), { slot: - 1 } );
		expect( draw.capacity ).toBeGreaterThan( 64 );
		expect( seen( draw, camera ) ).toEqual( [ false, false ] );
		draw.add( at( 0, - 5 ), new THREE.Color(), { slot: - 1 } );
		expect( seen( draw, camera ) ).toEqual( [ true, true ] );
		draw.dispose();

	} );

} );
