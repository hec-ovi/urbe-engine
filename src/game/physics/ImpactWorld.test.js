import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { ImpactWorld, Physics, RagdollError } from './index.js';

describe( 'live vehicle and pedestrian impact physics', () => {

	it( 'reports one closed impact only after Rapier measures the overlapping bodies', async () => {

		const physics = await Physics.create();
		const impacts = new ImpactWorld( physics );
		const person = { id: 'person:one', position: new THREE.Vector3( 0, 0, 0 ) };
		const vehicle = {
			id: 'car:one', position: new THREE.Vector3( 0, 0, - 1 ),
			heading: 0, pitch: 0, speed: 8
		};

		impacts.sync( { people: [ person ], vehicles: [ vehicle ] } );
		physics.step( 1 / 60 );
		const [ hit ] = impacts.drain();

		expect( hit ).toEqual( {
			personId: 'person:one',
			vehicleId: 'car:one',
			point: { x: 0, y: 1.05, z: 0 },
			impulse: { x: 0, y: 6, z: 60 }
		} );
		expect( impacts.drain() ).toEqual( [] );

		impacts.release( person.id );
		physics.step( 1 / 60 );
		expect( impacts.drain() ).toHaveLength( 1 );

	} );

	it( 'does not turn a slow overlap into an impact and cleans up idempotently', async () => {

		const physics = await Physics.create();
		const impacts = new ImpactWorld( physics );
		impacts.sync( {
			people: [ { id: 'person:slow', position: new THREE.Vector3() } ],
			vehicles: [ { id: 'car:slow', position: new THREE.Vector3(), heading: 0, pitch: 0, speed: 1.9 } ]
		} );
		physics.step( 1 / 60 );
		expect( impacts.drain() ).toEqual( [] );

		impacts.dispose();
		impacts.dispose();
		expect( () => impacts.drain() ).toThrowError( RagdollError );

	} );

} );
