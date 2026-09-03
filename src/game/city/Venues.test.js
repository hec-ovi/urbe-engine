import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { Venues, frameStrip } from './Venues.js';

const atlas = {
	parcels: [
		{ id: 'p0', type: 'coffee_shop' },
		{ id: 'p1', type: 'residential' },
		{ id: 'p2', type: 'commerce' }
	]
};

/** One entrance, as DoorGeometry hands it over. */
function door( parcelId ) {

	return {
		parcelId,
		normal: new THREE.Vector3( 0, 0, 1 ),
		along: new THREE.Vector3( 1, 0, 0 ),
		center: new THREE.Vector3( 0, 0, 0 ),
		width: 1.2,
		height: 2.2,
		outside: new THREE.Vector3( 0, 0, 2 ),
		box: new THREE.Box3( new THREE.Vector3( - 0.6, 0, - 0.1 ), new THREE.Vector3( 0.6, 2.2, 0.1 ) )
	};

}

const fixtures = [
	{ parcelId: 'p0', kind: 'sign', lumens: 200 },
	{ parcelId: 'p0', kind: 'entrance', lumens: 800 },
	{ parcelId: 'p2', kind: 'sign', lumens: 300 }
];

const factory = {
	build: ( key ) => {

		const material = new THREE.MeshBasicMaterial();
		material.userData = { key };
		return material;

	},
	variant: ( key, tweaks ) => {

		const material = new THREE.MeshBasicMaterial();
		material.userData = { key, tweaks };
		return material;

	}
};

function venues( doors, buildings ) {

	return new Venues( { atlas, buildings, doors, fixtures, factory } );

}

const built = ( ids, signage = [] ) => new Map( ids.map( ( id ) => [ id, { blueprint: { signage } } ] ) );

/**
 * The playtest complaint was that a real building and a sealed one look the
 * same. What has to hold is that only a building with a way in is marked, that
 * the mark is a fixture on the door and not a floating icon, and that a venue's
 * sign follows who is actually working there.
 */
describe( 'Venues', () => {

	it( 'marks only the venues that have a way in', () => {

		const marks = venues( [ door( 'p0' ), door( 'p1' ) ], built( [ 'p0', 'p1' ] ) ).marks;

		// p1 is a home, p2 has a door in no building the world built.
		expect( marks.map( ( entry ) => entry.parcelId ) ).toEqual( [ 'p0' ] );

	} );

	it( 'names the door after the sign over it, so the prompt can say where', () => {

		const doors = [ door( 'p0' ) ];

		venues( doors, built( [ 'p0' ], [ { text: 'COFFEE' } ] ) );

		expect( doors[ 0 ].name ).toBe( 'COFFEE' );

	} );

	it( 'builds one lit frame for the whole city, on the doors that are real', () => {

		const doors = [ door( 'p0' ), door( 'p2' ) ];
		const group = venues( doors, built( [ 'p0', 'p2' ] ) ).build( doors );

		expect( group.children ).toHaveLength( 2 );
		expect( group.getObjectByName( 'entrance-frame:housing' ).material.userData.key )
			.toBe( 'cyberpunk/window-frame/mid' );
		const lens = group.getObjectByName( 'entrance-frame:lens' );
		expect( lens.material.userData.key ).toBe( 'cyberpunk/light-fixture/mid' );
		expect( lens.material.userData.tweaks.variantId ).toBe( 'strip' );
		expect( lens.geometry.getAttribute( 'position' ).count ).toBeGreaterThan( 0 );

	} );

	it( 'keeps every emitting face outward on rotated entrances', () => {

		for ( const normal of [
			new THREE.Vector3( 0, 0, 1 ), new THREE.Vector3( 1, 0, 0 ),
			new THREE.Vector3( 0, 0, - 1 ), new THREE.Vector3( - 1, 0, 0 )
		] ) {

			const entry = door( 'p0' );
			entry.normal.copy( normal );
			entry.along.set( normal.z, 0, - normal.x );
			const { housings, lenses } = frameStrip( entry );

			expect( housings ).toHaveLength( 3 );
			expect( lenses ).toHaveLength( 3 );

			for ( const geometry of lenses ) {

				const normals = geometry.getAttribute( 'normal' );

				for ( let i = 0; i < normals.count; i ++ ) {

					const face = new THREE.Vector3().fromBufferAttribute( normals, i );
					expect( face.dot( normal ) ).toBeCloseTo( 1, 6 );

				}

			}

		}

	} );

	it( 'puts a venue sign out when the simulation has nobody working there', () => {

		const model = venues( [ door( 'p0' ), door( 'p2' ) ], built( [ 'p0', 'p2' ] ) );
		const dims = new Map();
		const lights = { setFixtureDim: ( index, dim ) => dims.set( index, dim ) };
		const shut = { crowd: () => ( { agents: [] } ) };
		const open = { crowd: () => ( { agents: [ {} ] } ) };
		const feet = new THREE.Vector3();

		model.update( 10, feet, 780, shut, lights );

		expect( dims.get( 0 ) ).toBe( 0 );
		expect( dims.get( 2 ) ).toBe( 0 );
		// The entrance fixture is not a sign and never goes out with the rota.
		expect( dims.has( 1 ) ).toBe( false );

		model.update( 10, feet, 1200, open, lights );

		expect( dims.get( 0 ) ).toBe( 1 );

	} );

} );
