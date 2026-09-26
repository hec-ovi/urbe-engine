import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { HIDDEN_FAR, SphereCulledBatch } from './SphereCulledBatch.js';

/** The same copies in a three batch and in a kept-sphere batch. */
function pair() {

	const material = new THREE.MeshStandardMaterial();
	const box = new THREE.BoxGeometry( 2, 6, 2 ).translate( 0, 3, 0 );
	const slab = new THREE.BoxGeometry( 8, 0.4, 8 );
	const batches = [ new THREE.BatchedMesh( 4, 200, 400, material ), new SphereCulledBatch( 4, 200, 400, material ) ];

	for ( const batch of batches ) {

		batch.sortObjects = false;
		const ids = [ batch.addGeometry( box ), batch.addGeometry( slab ) ];
		const at = ( id, x, z ) => batch.setMatrixAt( batch.addInstance( ids[ id ] ), new THREE.Matrix4().makeTranslation( x, 0, z ) );
		at( 0, 0, - 20 );
		at( 1, 3, - 40 );
		at( 0, 0, 30 );
		at( 1, 200, - 10 );

	}

	return batches;

}

function drawList( batch, camera ) {

	batch.onBeforeRender( null, null, camera, batch.geometry, batch.material );

	return Array.from( { length: batch._multiDrawCount }, ( unused, draw ) => [
		batch._indirectTexture.image.data[ draw ], batch._multiDrawStarts[ draw ], batch._multiDrawCounts[ draw ]
	] );

}

describe( 'a batch that keeps each copy\'s sphere', () => {

	it( 'draws exactly what three draws, copy for copy, as the copies grow, move and hide', () => {

		const camera = new THREE.PerspectiveCamera( 70, 1, 0.2, 900 );
		camera.updateMatrixWorld();
		const [ three, kept ] = pair();

		expect( drawList( kept, camera ) ).toEqual( drawList( three, camera ) );
		expect( drawList( kept, camera ).map( ( [ copy ] ) => copy ) ).toEqual( [ 0, 1 ] );

		for ( const batch of [ three, kept ] ) {

			batch.setInstanceCount( 8 );
			batch.setMatrixAt( 3, new THREE.Matrix4().makeTranslation( 0, 0, - 60 ) );
			batch.setGeometryIdAt( 2, 1 );
			batch.setMatrixAt( 2, new THREE.Matrix4().makeTranslation( 5, 0, - 5 ) );
			batch.setVisibleAt( 0, false );

		}
		camera.position.set( 1, 2, 3 );
		camera.rotation.y = 0.3;
		camera.updateMatrixWorld();

		expect( drawList( kept, camera ) ).toEqual( drawList( three, camera ) );
		expect( drawList( kept, camera ).map( ( [ copy ] ) => copy ).sort() ).toEqual( [ 1, 2, 3 ] );

	} );

	it( 'draws a copy\'s far geometry, or nothing, once its whole sphere lies past the far distance', () => {

		const material = new THREE.MeshStandardMaterial();
		const batch = new SphereCulledBatch( 4, 400, 800, material );
		batch.sortObjects = false;
		const near = batch.addGeometry( new THREE.BoxGeometry( 2, 2, 2, 4, 4, 4 ) );
		const far = batch.addGeometry( new THREE.BoxGeometry( 2, 2, 2 ) );
		const copies = [ 20, 60, 100 ].map( ( z ) => {

			const copy = batch.addInstance( near );
			batch.setMatrixAt( copy, new THREE.Matrix4().makeTranslation( 0, 0, - z ) );

			return copy;

		} );
		batch.setFarAt( copies[ 1 ], far );
		batch.setFarAt( copies[ 2 ], HIDDEN_FAR );
		const camera = new THREE.PerspectiveCamera( 70, 1, 0.2, 900 );
		camera.updateMatrixWorld();
		const counts = () => drawList( batch, camera ).map( ( [ copy, , count ] ) => [ copy, count ] );
		const whole = batch.getGeometryRangeAt( near ).count;
		const simple = batch.getGeometryRangeAt( far ).count;

		// No point named yet: every copy is near.
		expect( counts() ).toEqual( [ [ 0, whole ], [ 1, whole ], [ 2, whole ] ] );

		batch.lod = { point: new THREE.Vector3(), distance: 40 };
		expect( counts() ).toEqual( [ [ 0, whole ], [ 1, simple ] ] );

		// Measured from the point, not from the camera drawing the pass.
		batch.lod.point.set( 0, 0, - 80 );
		expect( counts() ).toEqual( [ [ 0, whole ], [ 1, whole ], [ 2, whole ] ] );

	} );

} );
