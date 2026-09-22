import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { GameApp, occupiedBuildingFootprints, localObjectivePlace, currentObjectiveView, questPlayerPlaces } from './GameApp.js';
import { Locator } from './world/Locator.js';

describe( 'GameApp quest NPC control', () => {

	it( 'exposes only an explicit selected-cast control event with live clock and player position', () => {

		const app = Object.create( GameApp.prototype );
		app.clock = { timeMin: 725 };
		app.body = { feet: new THREE.Vector3( 4, 5, 6 ) };
		app.questGameplay = { control: vi.fn( ( request ) => ( { ok: true, ...request } ) ) };

		expect( app.questNpcControl( { kind: 'start-follow', npcId: 'cast-a' } ) ).toMatchObject( {
			ok: true, kind: 'start-follow', npcId: 'cast-a', timeMin: 725, playerPosition: { x: 4, y: 5, z: 6 }
		} );

	} );

} );

describe( 'quest guidance inside a merged building', () => {

	it( 'uses the standing p19 venue across its absorbed p20 lot and points to Petra instead of the street entrance', () => {

		const atlas = {
			districts: [ { id: 'd0', kind: 'downtown', tier: 'rich', boundary: [ [ 400, 30 ], [ 470, 30 ], [ 470, 80 ], [ 400, 80 ] ] } ],
			parcels: [
				{ id: 'p19', type: 'commerce', lot: [ [ 404, 33.7 ], [ 428, 33.7 ], [ 428, 73.7 ], [ 404, 73.7 ] ] },
				{ id: 'p20', type: 'hotel', lot: [ [ 428, 33.7 ], [ 468, 33.7 ], [ 468, 73.7 ], [ 428, 73.7 ] ] }
			]
		};
		const outline = [ [ 406.5, 36.7 ], [ 465.5, 36.7 ], [ 465.5, 70.7 ], [ 406.5, 70.7 ] ];
		const shellCatalog = { buildings: [ { id: 'p19', bands: [ { bottom: 0, top: 58.5, outline } ] } ] };
		const locator = new Locator( atlas, [], [], { buildingFootprints: occupiedBuildingFootprints( shellCatalog ) } );
		const feet = new THREE.Vector3( 462.64, 0.02, 39.88 );
		const member = { npcId: 'a659', parcelId: 'p19', position: new THREE.Vector3( 464.14, 0, 39.88 ) };
		const active = {
			title: 'The Weir Line', text: 'Hear Petra out about her brother.', venue: 'MARKET',
			place: { kind: 'parcel', id: 'p19' }, actorIds: [ 'a659' ], availability: { available: true }
		};
		const session = { characterName: () => ( { given: 'Petra', family: 'Moss' } ) };
		const crowd = { memberForNpc: () => member };
		const local = localObjectivePlace( active, { locator, crowd, session, feet } );

		expect( locator.location( feet.x, feet.z ).id ).toBe( 'p19' );
		expect( questPlayerPlaces( locator, feet ) ).toContainEqual( { kind: 'parcel', id: 'p19' } );
		expect( questPlayerPlaces( locator, feet ) ).not.toContainEqual( { kind: 'parcel', id: 'p20' } );
		expect( local ).toEqual( { label: 'Inside · Petra Moss · Ground floor', distanceMeters: 2 } );
		expect( currentObjectiveView( active, session, {
			local, route: { destination: { kind: 'parcel', id: 'p19' }, distanceMeters: 86.8056 }
		} ).place ).toEqual( { name: 'MARKET · Inside · Petra Moss · Ground floor', distanceMeters: 2 } );
		// Being on the original lot but outside the actual building still needs
		// the ordinary entrance route; a setback is not an indoor arrival.
		expect( localObjectivePlace( active, { locator, crowd, session, feet: new THREE.Vector3( 405, 0, 40 ) } ) ).toBeNull();

	} );

} );
