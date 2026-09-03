import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { BuildingsLoader } from './BuildingsLoader.js';

const factory = {
	resolver: { resolve: () => null },
	build: () => new THREE.MeshBasicMaterial(),
	variant: () => new THREE.MeshBasicMaterial()
};

describe( 'building entrance availability', () => {

	it( 'keeps a shell-only door fixed in the visible shell and out of interactions', async () => {

		const city = await load( false );

		expect( city.doors ).toEqual( [] );
		expect( city.group.getObjectByName( 'shell:cyberpunk/door/mid' ) ).toBeTruthy();
		expect( city.shellColliders.get( 'p0' ).getAttribute( 'position' ).count ).toBe( 3 );

	} );

	it( 'extracts and hinges only a door whose parcel has an interior', async () => {

		const city = await load( true );

		expect( city.doors ).toHaveLength( 1 );
		expect( city.doors[ 0 ].parcelId ).toBe( 'p0' );
		expect( city.group.getObjectByName( 'door:p0:0' ) ).toBeTruthy();

	} );

} );

async function load( hasInterior ) {

	const loader = { loadAsync: async () => {

		const scene = new THREE.Group();
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [ 1, 0, 0, 2, 0, 0, 1, 2, 0 ], 3 ) );
		const material = new THREE.MeshBasicMaterial();
		material.name = 'cyberpunk/door/mid';
		const leaf = new THREE.Mesh( geometry, material );
		leaf.name = 'doorentranceleaf0';
		scene.add( leaf );

		return { scene };

	} };
	const blueprint = {
		buildingId: 'p0',
		bounds: { footprint: [ [ 0, 0 ], [ 4, 0 ], [ 4, 4 ], [ 0, 4 ] ] },
		floors: [ {
			index: 0, elevation: 0,
			outline: [ [ 0, 0 ], [ 4, 0 ], [ 4, 4 ], [ 0, 4 ] ],
			openings: [ { kind: 'door', edge: 0, offset: 1, width: 1, sill: 0, height: 2 } ]
		} ]
	};
	const buildings = new Map( [ [ 'p0', { parcelId: 'p0', blueprint, shellUrl: '/p0.glb', hasInterior } ] ] );

	return new BuildingsLoader( factory, loader ).load( buildings );

}
