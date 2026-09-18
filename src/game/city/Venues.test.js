import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { Venues } from './Venues.js';

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
		surfaceDepth: 0.08,
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
 * A real building and a sealed one have to look different: only a building with
 * a way in is marked, the mark is a fixture on the door rather than a floating
 * icon, and a venue's sign follows who is actually working there.
 */
describe( 'Venues', () => {

	it( 'marks only the venues that have a way in, and names the door after its sign', () => {

		const doors = [ door( 'p0' ), door( 'p1' ) ];
		const marks = venues( doors, built( [ 'p0', 'p1' ], [ { text: 'COFFEE' } ] ) ).marks;

		// p1 is a home, p2 has a door in no building the world built.
		expect( marks.map( ( entry ) => entry.parcelId ) ).toEqual( [ 'p0' ] );
		expect( doors[ 0 ].name ).toBe( 'COFFEE' );

	} );

	it( 'hangs an outward header fixture over every playable entrance and puts its sign out with the rota', () => {

		for ( const normal of [
			new THREE.Vector3( 0, 0, 1 ), new THREE.Vector3( 1, 0, 0 ),
			new THREE.Vector3( 0, 0, - 1 ), new THREE.Vector3( - 1, 0, 0 )
		] ) {

			const entry = door( 'p0' );
			entry.normal.copy( normal );
			entry.along.set( normal.z, 0, - normal.x );
			const group = venues( [ entry ], built( [ 'p0' ] ) ).build( [ entry ] );
			const housing = group.getObjectByName( 'entrance-header:housing' );
			const lens = group.getObjectByName( 'entrance-header:lens' );

			// Two city draws for every entrance: the housing and the lit lens.
			expect( group.children ).toHaveLength( 2 );
			expect( housing.material.userData.key ).toBe( 'cyberpunk/window-frame/mid' );
			expect( lens.material.name ).toBe( 'entrance-header:light' );
			expect( lens.material.map ).toBeNull();
			expect( lens.material.emissiveMap ).toBeNull();
			expect( lens.material.emissiveIntensity ).toBe( 35 );
			expect( lens.geometry.getAttribute( 'position' ).count ).toBe( 6 );
			lens.geometry.computeBoundingBox();
			expect( lens.geometry.boundingBox.min.y ).toBeGreaterThan( entry.height );
			expect( lens.geometry.boundingBox.max.x - lens.geometry.boundingBox.min.x ).toBeLessThan( entry.width );

			// Every emitting face looks out of the building, in front of the wall.
			const faces = lens.geometry.getAttribute( 'normal' );
			for ( let i = 0; i < faces.count; i ++ ) {

				expect( new THREE.Vector3().fromBufferAttribute( faces, i ).dot( normal ) ).toBeCloseTo( 1, 6 );

			}

			const housingDepths = projectedDepths( housing.geometry, entry );
			const lensDepths = projectedDepths( lens.geometry, entry );
			expect( Math.min( ...housingDepths ) ).toBeGreaterThan( entry.surfaceDepth );
			expect( Math.min( ...lensDepths ) ).toBeGreaterThan( Math.max( ...housingDepths ) );

		}

		const model = venues( [ door( 'p0' ), door( 'p2' ) ], built( [ 'p0', 'p2' ] ) );
		const dims = new Map();
		const lights = { setFixtureDim: ( index, dim ) => dims.set( index, dim ) };
		const feet = new THREE.Vector3();

		model.update( 10, feet, 780, { crowd: () => ( { agents: [] } ) }, lights );

		expect( dims.get( 0 ) ).toBe( 0 );
		expect( dims.get( 2 ) ).toBe( 0 );
		// The entrance fixture is not a sign and never goes out with the rota.
		expect( dims.has( 1 ) ).toBe( false );

		model.update( 10, feet, 1200, { crowd: () => ( { agents: [ {} ] } ) }, lights );

		expect( dims.get( 0 ) ).toBe( 1 );

	} );

} );

function projectedDepths( geometry, entry ) {

	const positions = geometry.getAttribute( 'position' );
	const depths = [];

	for ( let i = 0; i < positions.count; i ++ ) {

		depths.push(
			( positions.getX( i ) - entry.center.x ) * entry.normal.x
			+ ( positions.getZ( i ) - entry.center.z ) * entry.normal.z
		);

	}

	return depths;

}
