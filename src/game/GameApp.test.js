import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { GameApp, companionScenes, occupiedBuildingFootprints, localObjectivePlace, currentObjectiveView, openingCard, questPlayerPlaces, npcContinuityPlaces } from './GameApp.js';
import { Locator } from './world/Locator.js';
import { WalkRoutes } from './agents/WalkRoutes.js';

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

describe( 'the card a game opens on', () => {

	it( 'routes successful document reads and evidence inspections to the reading card without advancing a read', () => {
		const app = Object.create( GameApp.prototype );
		app.view = { inspection: { show: vi.fn() }, toast: { show: vi.fn() } };
		app.questActionResult( { ok: true, progressed: false, action: 'read', message: 'Read the ledger.', readText: 'The authored entry.', completed: [] } );
		expect( app.view.inspection.show ).toHaveBeenLastCalledWith( { title: 'Read the ledger.', text: 'The authored entry.' } );
		app.questActionResult( { ok: true, progressed: false, action: 'inspect', message: 'A broken seal.', completed: [] } );
		expect( app.view.inspection.show ).toHaveBeenLastCalledWith( { title: 'Evidence inspected', text: 'A broken seal.' } );
		app.questActionResult( { ok: false, message: 'Move closer.' } );
		expect( app.view.inspection.show ).toHaveBeenCalledTimes( 2 );
		expect( app.view.toast.show ).toHaveBeenCalledWith( { title: 'Objective', text: 'Move closer.' } );
	} );

	it( 'is the story\'s prologue while the save has no play time, and nothing once played, unsaved or without one', () => {

		const quests = { prologue: () => ( { title: 'Undertow', text: 'You owe the House.' } ) };
		expect( openingCard( { unplayed: true }, quests ) ).toEqual( { kind: 'prologue', title: 'Undertow', text: 'You owe the House.' } );
		expect( openingCard( { unplayed: false }, quests ) ).toBeNull();
		expect( openingCard( null, quests ) ).toBeNull();
		expect( openingCard( { unplayed: true }, { prologue: () => null } ) ).toBeNull();

	} );

} );

describe( 'staged quest scenes as companion places', () => {

	it( 'makes one place of the scenes a parcel holds, with all their notes, and leaves out a parcel the companion cannot name', () => {

		const staged = [
			{ sceneId: 'q.body', place: { parcelId: 'p47', floor: 1, roomId: 'r2' }, notes: [ 'A body lies on the ground.' ] },
			{ sceneId: 'q.alley', place: { parcelId: 'p9' }, notes: [ 'Tyre marks streak the ground.' ] },
			{ sceneId: 'q.guard', place: { parcelId: 'p47', floor: 0, roomId: 'r0' }, notes: [ 'Someone stands there on guard.' ] }
		];
		const places = { name: ( place ) => ( place.id === 'p47' ? 'the flat on the corner' : null ) };

		expect( companionScenes( staged, places ) ).toEqual( [ {
			place: { kind: 'parcel', id: 'p47' }, name: 'the flat on the corner', relation: 'scene',
			notes: [ 'A body lies on the ground.', 'Someone stands there on guard.' ]
		} ] );
		expect( staged[ 0 ].notes ).toEqual( [ 'A body lies on the ground.' ] );

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

it('keeps conversation and outcome modals in control of pointer capture and gameplay keys',async()=>{
 const {playableModalOpen}=await import('./GameApp.js');
 const view={panels:{current:null},transit:{open:false},summary:{element:{hidden:true}}};
 expect(playableModalOpen(view,{conversation:null})).toBe(false);
 expect(playableModalOpen(view,{conversation:{npcId:'n'}})).toBe(true);
 view.summary.element.hidden=false;expect(playableModalOpen(view,{conversation:null})).toBe(true);
 view.summary.element.hidden=true;view.panels.current='QUESTS';expect(playableModalOpen(view,{conversation:null})).toBe(true);
});

describe( 'continuity places', () => {

	it( 'gives a leader a doorstep outside a parcel\'s door, or where the access path of one without a door meets the pavement', () => {

		const door = { parcelId: 'p1', inside: new THREE.Vector3( 1, 0, 2 ), outside: new THREE.Vector3( 1, 0, 5.2 ), normal: new THREE.Vector3( 0, 0, 1 ) };
		const atlas = { parcels: [ { id: 'p1', access: { point: [ 1, 6 ] } }, { id: 'p2', access: { point: [ 9, 6 ] } }, { id: 'p3', access: { point: [ 20, 6 ] } } ] };
		// The pavement runs along z = 7.2; p2's access path leaves its lot line at z = 6.
		const routes = new WalkRoutes( { walk: {
			nodes: [ { id: 'a', x: 0, y: 0, z: 7.2, kind: 'sidewalk' }, { id: 'b', x: 9, y: 0, z: 7.2, kind: 'sidewalk' }, { id: 'e2', x: 9, y: 0, z: 6, kind: 'entry', ref: 'p2' } ],
			edges: [
				{ id: 'pave', from: 'a', to: 'b', kind: 'sidewalk', path3: [ [ 0, 0, 7.2 ], [ 9, 0, 7.2 ] ] },
				{ id: 'in', from: 'e2', to: 'b', kind: 'access', path3: [ [ 9, 0, 6 ], [ 9, 0, 7.2 ] ] }
			]
		} } );
		const [ entered, open, lost ] = npcContinuityPlaces( atlas, [ door ], new Map(), routes );
		expect( entered ).toMatchObject( { kind: 'parcel', id: 'p1', position: [ 1, 0, 2 ], doorstep: [ 1, 0, 5.2 ] } );
		// Without a door the place stands at its access point on the lot line, which the building may fill;
		// a leader shows it from where its access path meets the pavement.
		expect( open ).toMatchObject( { position: [ 9, expect.any( Number ), 6 ], doorstep: [ 9, 0, 7.2 ] } );
		expect( lost ).not.toHaveProperty( 'doorstep' );

	} );

} );

describe( 'a rider in a lift', () => {

	it( 'sees the car from one height while it travels, because the cab carries the body before the camera is placed', async () => {

		const [ { Physics }, { PlayerBody }, { PlayerController }, { Elevators } ] = await Promise.all( [
			import( './physics/Physics.js' ), import( './physics/PlayerBody.js' ), import( './player/PlayerController.js' ), import( './city/Elevators.js' )
		] );
		const physics = await Physics.create();
		const material = new THREE.MeshBasicMaterial();
		const elevators = new Elevators( { build: () => material, variant: () => material } );
		const tower = Array.from( { length: 12 }, ( _, floor ) => ( { floor, elevation: floor * 4.5, height: 4.5,
			core: { elevators: [ { id: 'elev-0', rect: { x: 10, z: 20, w: 2.5, d: 2.5 }, doorEdge: 0 } ] } } ) );
		const [ shaft ] = elevators.add( 'p1', tower, new THREE.Group() );
		const body = new PlayerBody( physics, new THREE.Vector3( 11.25, 0.05, 21.25 ) );
		const camera = new THREE.PerspectiveCamera();
		const input = { locked: true, zooming: false, crouching: false, running: false, axis: () => ( { x: 0, z: 0 } ), consume: () => false, drainLook: () => ( { dx: 0, dy: 0 } ) };
		const controller = new PlayerController( { body, camera, input } );
		const app = Object.create( GameApp.prototype );
		Object.assign( app, { physics, body, elevators, controller, crowd: { pushback: () => new THREE.Vector3() }, traffic: { pushback: () => new THREE.Vector3() } } );

		try {

			shaft.select( 100 );
			shaft.press( { inside: true } );
			const heights = [];
			// Frames as uneven as a busy machine's, up to the game's cap.
			for ( let frame = 0; frame < 900 && ( ! heights.length || shaft.moving ); frame ++ ) {

				app.stepPlayer( [ 1 / 60, 0.05, 1 / 30, 0.012 ][ frame % 4 ] );
				if ( shaft.moving && body.carried ) heights.push( camera.position.y - shaft.cab.position.y );

			}
			expect( heights.length ).toBeGreaterThan( 100 );
			expect( Math.max( ...heights ) - Math.min( ...heights ) ).toBeLessThan( 1e-6 );
			expect( shaft.at ).toBeCloseTo( 49.5, 6 );

		} finally {

			physics.world.free();

		}

	} );

} );
