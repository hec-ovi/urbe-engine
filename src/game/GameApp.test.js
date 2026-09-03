import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import {
	GameApp, currentObjectiveView, npcContinuityPlaces, pickSpawn, playableInteractionOwner, playableTransitPrompt,
	prepareInteriorStreaming, questPlayerPlaces, restoredTransitQuest, savedSpawn, transitStartHour
} from './GameApp.js';
import { Locator } from './world/Locator.js';

describe( 'game spawn', () => {

	it( 'uses the authoritative height of the selected walk node', () => {

		const networks = { walk: { nodes: [
			{ id: 'near', x: 0, y: 8, z: 0, kind: 'corner' },
			{ id: 'far', x: 100, y: 8, z: 0, kind: 'corner' }
		] } };
		const atlas = { parcels: [ { access: { point: [ 0, 0 ] } } ] };
		const spawn = pickSpawn( networks, atlas );

		expect( spawn.point.y ).toBeCloseTo( 8.17 );
		expect( spawn.lookAt.y ).toBeCloseTo( 8.12 );

	} );

	it( 'restores the saved foot point and heading without deriving a new spawn', () => {

		const spawn = savedSpawn( { player: { position: { x: 14.5, y: 2.25, z: -8 }, heading: - 1.2 } } );
		expect( spawn.point.toArray() ).toEqual( [ 14.5, 2.25, - 8 ] );
		expect( spawn.heading ).toBe( - 1.2 );

	} );

} );

describe( 'persistent current quest objective', () => {

	it( 'publishes the current active objective restored by QuestGameplay', () => {

		const objective = {
			title: 'Night courier', text: 'Deliver the sealed drive', questId: 'q1', stepId: 's2'
		};
		const gameplay = { objective: vi.fn( () => objective ) };

		expect( currentObjectiveView( gameplay, { view: () => [] }, 725 ) ).toEqual( {
			title: 'Night courier', objective: 'Deliver the sealed drive', state: 'active'
		} );
		expect( gameplay.objective ).toHaveBeenCalledWith( 725 );

	} );

	it( 'holds the last completed objective, then hides when no quest exists', () => {

		const gameplay = { objective: () => null };
		const session = { view: () => [ {
			id: 'q1', title: 'Night courier', text: 'The drive arrived.', state: 'done',
			steps: [ { text: 'Collect the drive', done: true }, { text: 'Deliver the sealed drive', done: true } ]
		} ] };

		expect( currentObjectiveView( gameplay, session, 725 ) ).toEqual( {
			title: 'Night courier', objective: 'Deliver the sealed drive', state: 'done'
		} );
		expect( currentObjectiveView( gameplay, { view: () => [] }, 725 ) ).toBeNull();

	} );

} );

describe( 'streamed floor preparation', () => {

	it( 'attaches a floor-only warmup without compiling the complete city', () => {

		const stream = { warmup: null };
		const renderer = {};
		const scene = {};
		const camera = {};
		const mrt = { emissive: true };
		const warmup = prepareInteriorStreaming( stream, renderer, scene, camera, mrt );

		expect( stream.warmup ).toBe( warmup );
		expect( warmup.renderer ).toBe( renderer );
		expect( warmup.scene ).toBe( scene );
		expect( warmup.camera ).toBe( camera );
		expect( warmup.mrt ).toBe( mrt );

	} );

} );

describe( 'playable transit integration', () => {

	it( 'supplies exact public transport refs to quest frames and restores the boarded origin', () => {

		const atlas = {
			districts: [], parcels: [],
			transit: {
				busStops: [ { id: 'stop-a', position: [ 0, 0 ] } ],
				trainStations: [ {
					id: 'station-b', position: [ 20, 0 ], level: 4,
					platform: [ [ 18, -2 ], [ 22, -2 ], [ 22, 2 ], [ 18, 2 ] ]
				} ],
				subwayStations: []
			}
		};
		const routes = [ {
			id: 'route-a', kind: 'bus', stops: [
				{ stopId: 'stop-a', y: 3 }, { stopId: 'stop-c', y: 3 }
			]
		} ];
		const locator = new Locator( atlas, routes );
		expect( questPlayerPlaces( locator, new THREE.Vector3( 0, 3, 0 ) ) ).toEqual( [
			{ kind: 'stop', id: 'stop-a' }
		] );
		expect( questPlayerPlaces( locator, new THREE.Vector3( 20, 4, 0 ) ) ).toEqual( [
			{ kind: 'station', id: 'station-b' }
		] );

		const state = {
			status: 'aboard', clock: { dayOffset: 0, lastDaySeconds: 3600 },
			tripId: 'trip-a', routeId: 'route-a', serviceDeparture: 3500, boardedStopIndex: 0
		};
		expect( restoredTransitQuest(
			{ valid: true, state }, routes, 60, new THREE.Vector3( 5, 3, 0 )
		) ).toEqual( {
			timeMin: 60, origin: { kind: 'stop', id: 'stop-a' },
			position: { x: 5, y: 3, z: 0 }, tripId: 'trip-a', routeId: 'route-a'
		} );

	} );

	it( 'restores the exact active timetable clock including a day rollover', () => {

		const journey = {
			valid: true,
			state: { status: 'aboard', clock: { dayOffset: 86400, lastDaySeconds: 125 } }
		};

		expect( transitStartHour( journey, 21 ) ).toBe( 86525 / 3600 );
		expect( transitStartHour( { ...journey, valid: false }, 21 ) ).toBe( 21 );
		expect( transitStartHour( {
			valid: true, state: { status: 'waiting', clock: { dayOffset: 0, lastDaySeconds: 125 } }
		}, 21 ) ).toBe( 21 );

	} );

	it( 'gives aimed world targets priority while waiting and the ride priority while aboard', () => {

		expect( playableTransitPrompt( 'E  open door', {
			aboard: false, prompt: 'E  board Bus B1'
		} ) ).toBe( 'E  open door' );
		expect( playableTransitPrompt( null, {
			aboard: false, prompt: 'E  board Bus B1'
		} ) ).toBe( 'E  board Bus B1' );
		expect( playableTransitPrompt( 'E  talk', {
			aboard: true, prompt: 'E  leave bus B1 at stop-b'
		} ) ).toBe( 'E  leave bus B1 at stop-b' );
		expect( playableInteractionOwner( { conversation: {}, target: {} }, { aboard: true } ) ).toBe( 'conversation' );
		expect( playableInteractionOwner( { conversation: null, target: {} }, { aboard: false } ) ).toBe( 'world' );
		expect( playableInteractionOwner( { conversation: null, target: {} }, { aboard: true } ) ).toBe( 'transit' );
		expect( playableInteractionOwner( { conversation: null, target: null }, { aboard: false } ) ).toBe( 'transit' );

	} );

} );

describe( 'live NPC continuity integration', () => {

	it( 'publishes all scheduled parcel positions and interior anchors in the controller contract', () => {

		const atlas = { parcels: [
			{ id: 'cafe', access: { point: [ 5, 6 ] } },
			{ id: 'home', access: { point: [ 20, 30 ] } }
		] };
		const doors = [ {
			parcelId: 'cafe', inside: new THREE.Vector3( 1, 2, 3 ), normal: new THREE.Vector3( 0, 0, 1 )
		} ];
		const buildings = new Map( [ [ 'cafe', { npc: { anchors: [ {
			id: 'coffee', floor: 0, kind: 'work_spot', position: [ 7, 8 ], facingDeg: 0
		} ] } } ] ] );

		expect( npcContinuityPlaces( atlas, doors, buildings ) ).toEqual( [
			{
				kind: 'parcel', id: 'cafe', position: [ 1, 2, 3 ], heading: 0,
				anchors: [ { id: 'coffee', position: [ 7, 2, 8 ], heading: Math.PI / 2 } ]
			},
			{ kind: 'parcel', id: 'home', position: [ 20, 0.12, 30 ], heading: 0, anchors: [] }
		] );

	} );

	it( 'publishes bus stops and station platforms as exact simulation stop positions', () => {

		const atlas = {
			parcels: [],
			transit: {
				busStops: [ { id: 'bus-a', position: [ 3, 4 ] } ],
				trainStations: [ { id: 'rail-b', position: [ 8, 9 ], level: 2 } ],
				subwayStations: [ { id: 'metro-c', position: [ 12, 13 ], level: -8 } ]
			}
		};
		const routes = [ { stops: [ { stopId: 'bus-a', y: 1.5 } ] } ];
		expect( npcContinuityPlaces( atlas, [], new Map(), routes ) ).toEqual( [
			{ kind: 'stop', id: 'bus-a', position: [ 3, 1.5, 4 ] },
			{ kind: 'stop', id: 'rail-b', position: [ 8, 2, 9 ] },
			{ kind: 'stop', id: 'metro-c', position: [ 12, -8, 13 ] }
		] );

	} );

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
