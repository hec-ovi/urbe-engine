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

	it( 'draws exactly what three draws, copy for copy, as the copies grow, move and hide and their geometry changes', () => {

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
			// A geometry replaced under a standing copy moves its sphere too: this
			// one stands below the view until its box grows up into it.
			batch.setMatrixAt( batch.addInstance( 0 ), new THREE.Matrix4().makeTranslation( 0, - 40, - 20 ) );
			batch.setGeometryAt( 0, new THREE.BoxGeometry( 2, 60, 2 ).translate( 0, 30, 0 ) );

		}
		camera.position.set( 1, 2, 3 );
		camera.rotation.y = 0.3;
		camera.updateMatrixWorld();

		expect( drawList( kept, camera ) ).toEqual( drawList( three, camera ) );
		expect( drawList( kept, camera ).map( ( [ copy ] ) => copy ).sort() ).toEqual( [ 1, 2, 3, 4 ] );

	} );

	it( 'draws a copy\'s far geometry, or nothing, once its whole sphere lies past the far distance, whenever the far geometry arrived', () => {

		const material = new THREE.MeshStandardMaterial();
		const batch = new SphereCulledBatch( 4, 600, 2000, material );
		batch.sortObjects = false;
		const detailed = new THREE.BoxGeometry( 2, 2, 2, 4, 4, 4 );
		const [ simplified, hidden, near ] = [ detailed, detailed.clone(), detailed.clone() ].map( ( geometry ) => batch.addGeometry( geometry ) );
		[ [ simplified, 20 ], [ simplified, 60 ], [ hidden, 100 ], [ near, 60 ] ].forEach( ( [ geometry, z ] ) => {

			batch.setMatrixAt( batch.addInstance( geometry ), new THREE.Matrix4().makeTranslation( 0, 0, - z ) );

		} );
		// The far geometries arrive after the copies stand, as a worker answers.
		const far = batch.addGeometry( new THREE.BoxGeometry( 2, 2, 2 ) );
		batch.setFarOf( simplified, far );
		batch.setFarOf( hidden, HIDDEN_FAR );
		const camera = new THREE.PerspectiveCamera( 70, 1, 0.2, 900 );
		camera.updateMatrixWorld();
		const counts = () => drawList( batch, camera ).map( ( [ copy, , count ] ) => [ copy, count ] );
		const whole = batch.getGeometryRangeAt( simplified ).count;
		const simple = batch.getGeometryRangeAt( far ).count;

		// No point named yet: every copy is near.
		expect( counts() ).toEqual( [ [ 0, whole ], [ 1, whole ], [ 2, whole ], [ 3, whole ] ] );

		batch.lod = { point: new THREE.Vector3(), distance: 40 };
		expect( counts() ).toEqual( [ [ 0, whole ], [ 1, simple ], [ 3, whole ] ] );

		// Measured from the point, not from the camera drawing the pass.
		batch.lod.point.set( 0, 0, - 80 );
		expect( counts() ).toEqual( [ [ 0, simple ], [ 1, whole ], [ 2, whole ], [ 3, whole ] ] );

	} );

} );
