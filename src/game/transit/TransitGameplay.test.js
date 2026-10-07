import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { TransitGameplay, transitErrorMessage } from './TransitGameplay.js';
import { TransitJourneyBoundary } from './TransitJourneyBoundary.js';
import { Locator } from '../world/Locator.js';

describe( 'TransitGameplay', () => {

	const mode = { kind: 'bus', placeKind: 'bus-stop', ids: [ 'b0', 'b1', 'b2' ], y: 0, z: 0 };

	it( 'drives the player through a ride and restores control at the published place', () => {

		const { gameplay, controller } = harness( city(), [ transitRoute( mode ) ], [ 0, mode.y, mode.z ] );
		const waiting = gameplay.update( { daySeconds: 1005 } );
		expect( waiting.prompt ).toContain( 'board Bus' );
		expect( gameplay.activate().result.ok ).toBe( true );
		expect( controller.movementLocked ).toBe( true );

		const moving = gameplay.update( { daySeconds: 1060 } );
		expect( controller.body.feet.toArray() ).toEqual( [ 50, mode.y, mode.z ] );
		expect( moving.status ).toMatchObject( { kind: mode.kind, lineId: `line-${mode.kind}`, nextStopId: mode.ids[ 1 ] } );
		expect( moving.prompt ).toBeNull();

		const dwelling = gameplay.update( { daySeconds: 1115 } );
		expect( dwelling.prompt ).toBe( `E  leave ${mode.kind} line-${mode.kind} at ${mode.ids[ 1 ]}` );
		expect( gameplay.activate().result.ok ).toBe( true );
		expect( controller.body.feet.toArray() ).toEqual( [ 100, mode.y, mode.z ] );
		expect( controller.movementLocked ).toBe( false );

	} );

	it( 'returns control at the terminus when the service ends', () => {

		const { gameplay, controller } = harness( city(), [ transitRoute( mode ) ], [ 0, mode.y, mode.z ] );
		gameplay.update( { daySeconds: 1005 } );
		gameplay.activate();

		expect( gameplay.update( { daySeconds: 1221 } ) ).toMatchObject( {
			aboard: false,
			result: { ok: true, autoDisembarked: true, state: { status: 'waiting' } }
		} );
		expect( controller.body.feet.toArray() ).toEqual( [ 200, mode.y, mode.z ] );
		expect( controller.movementLocked ).toBe( false );

	} );

	it( 'leaves a higher-priority world interaction on E and offers an explicit choice for a tie', () => {

		const atlas = city();
		const routes = [
			transitRoute( { kind: 'bus', ids: [ 'b0', 'b1', 'b2' ], y: 0, z: 0 } ),
			{ ...transitRoute( { kind: 'bus', ids: [ 'b0', 'b2', 'b1' ], y: 0, z: 0 } ), id: 'route-bus-2', lineId: 'line-bus-2' }
		];
		const { gameplay } = harness( atlas, routes, [ 0, 0, 0 ] );

		const boundary = new TransitJourneyBoundary();
		const blocked = gameplay.update( { daySeconds: 1005, interactionBlocked: true } );
		expect( blocked.prompt ).toBeNull();
		expect( boundary.valid( 'gameplay-update-request', {
			daySeconds: 1005, interactionBlocked: true
		} ) ).toBe( true );
		expect( boundary.valid( 'gameplay-view', blocked ) ).toBe( true );
		const waiting = gameplay.update( { daySeconds: 1005 } );
		expect( waiting.services ).toHaveLength( 2 );
		const choice = gameplay.activate();
		expect( choice ).toMatchObject( { action: 'choose', services: waiting.services } );
		expect( boundary.valid( 'gameplay-action', choice ) ).toBe( true );
		expect( boundary.valid( 'gameplay-service-selection', waiting.services[ 1 ] ) ).toBe( true );
		expect( gameplay.board( waiting.services[ 1 ] ).result.ok ).toBe( true );

	} );

	it( 'charges the fare once on boarding and on station travel, and keeps a player who cannot pay where they stand', () => {

		let purse = 1;
		const charged = [];
		const fare = { ride: 2, station: 3, can: ( n ) => n <= purse, charge: ( n, what ) => { purse -= n; charged.push( [ n, what ] ); } };
		const { gameplay, controller } = harness( city(), [ transitRoute( mode ) ], [ 0, mode.y, mode.z ], undefined, fare );
		gameplay.update( { daySeconds: 1005 } );
		expect( gameplay.activate().result ).toEqual( { ok: false, error: 'E_TRANSIT_FARE' } );
		expect( controller.movementLocked ).toBe( false );
		expect( gameplay.state.status ).toBe( 'waiting' );
		expect( transitErrorMessage( 'E_TRANSIT_FARE' ) ).toBe( 'You cannot pay the fare.' );
		expect( new TransitJourneyBoundary().valid( 'gameplay-action', { action: 'board', result: { ok: false, error: 'E_TRANSIT_FARE' } } ) ).toBe( true );
		purse = 10;
		gameplay.update( { daySeconds: 1005 } );
		expect( gameplay.activate().result.ok ).toBe( true );
		gameplay.update( { daySeconds: 1060 } );
		expect( charged ).toEqual( [ [ 2, 'ride' ] ] );

		// Between stations: the same, at the station fare.
		const station = harness( city(), [ transitRoute( mode ) ], [ 0, mode.y, mode.z ], undefined, fare );
		const choice = { stationId: 's1', destinationId: 's2', name: 'Ost' };
		station.gameplay.stationTravel = { near: () => true, choices: () => [ choice ], travel: () => ( { ok: true, position: [ 9, 0, 9 ], heading: 1 } ) };
		purse = 2;
		station.gameplay.update( { daySeconds: 1005 } );
		station.gameplay.activate();
		expect( station.gameplay.selectDestination( choice ).result ).toEqual( { ok: false, error: 'E_TRANSIT_FARE' } );
		purse = 3;
		station.gameplay.update( { daySeconds: 1005 } );
		station.gameplay.activate();
		expect( station.gameplay.selectDestination( choice ).result.ok ).toBe( true );
		expect( charged.at( - 1 ) ).toEqual( [ 3, 'station' ] );
		expect( purse ).toBe( 0 );

		// No fare, as before credits: every ride is free.
		const free = harness( city(), [ transitRoute( mode ) ], [ 0, mode.y, mode.z ] );
		free.gameplay.update( { daySeconds: 1005 } );
		expect( free.gameplay.activate().result.ok ).toBe( true );

	} );

	it( 'rejects a stale or clock-less aboard restore without moving the player', () => {

		const route = transitRoute( mode );
		const saved = {
			status: 'aboard', clock: { dayOffset: 0, lastDaySeconds: 1005 },
			tripId: 'trip:7:missing:1000', routeId: 'missing', serviceDeparture: 1000, boardedStopIndex: 0
		};
		const { gameplay, controller } = harness( city(), [ route ], [ 0, 0, 0 ], saved );

		expect( gameplay.restoreRejected ).toBe( true );
		expect( gameplay.state.status ).toBe( 'waiting' );
		expect( controller.begins ).toBe( 0 );
		expect( gameplay.update( { daySeconds: 1005 } ).services ).toHaveLength( 1 );

		const clockless = harness( city(), [ route ], [ 0, 0, 0 ], {
			...saved, clock: { dayOffset: 0, lastDaySeconds: null },
			tripId: 'trip:9:route-bus:1000', routeId: 'route-bus'
		} ).gameplay;
		expect( clockless.restoreRejected ).toBe( true );
		expect( clockless.state.status ).toBe( 'waiting' );

	} );

} );

function harness( atlas, routes, position, state, fare = null ) {

	const body = { feet: new THREE.Vector3().fromArray( position ) };
	const controller = {
		body, movementLocked: false, begins: 0,
		beginRide: ( point ) => {

			controller.begins ++;
			controller.movementLocked = true;
			body.feet.fromArray( point );

		},
		carry: ( point ) => body.feet.fromArray( point ),
		endRide: ( point ) => {

			controller.movementLocked = false;
			body.feet.fromArray( point );

		}
	};
	return {
		controller,
		gameplay: new TransitGameplay( { atlas, routes, state, locator: new Locator( atlas, routes ), controller, fare } )
	};

}

function city() {

	const platform = ( x, z ) => [ [ x - 8, z - 3 ], [ x + 8, z - 3 ], [ x + 8, z + 3 ], [ x - 8, z + 3 ] ];
	return {
		districts: [], parcels: [],
		transit: {
			busStops: [ 0, 100, 200 ].map( ( x, index ) => ( { id: `b${index}`, position: [ x, 0 ] } ) ),
			trainStations: [ 0, 100, 200 ].map( ( x, index ) => ( {
				id: `t${index}`, position: [ x, 20 ], level: 0, platform: platform( x, 20 )
			} ) ),
			subwayStations: [ 0, 100, 200 ].map( ( x, index ) => ( {
				id: `s${index}`, position: [ x, 40 ], level: -12, platform: platform( x, 40 )
			} ) )
		}
	};

}

function transitRoute( mode ) {

	return {
		id: `route-${mode.kind}`, kind: mode.kind, lineId: `line-${mode.kind}`,
		stops: mode.ids.map( ( id, index ) => ( {
			stopId: id, x: index * 100, y: mode.y, z: mode.z, shapeDist: index * 100
		} ) ),
		shape: [ [ 0, mode.y, mode.z ], [ 100, mode.y, mode.z ], [ 200, mode.y, mode.z ] ],
		template: [ { arrive: 0, depart: 10 }, { arrive: 110, depart: 120 }, { arrive: 220, depart: 220 } ],
		service: [ { start: 1000, end: 2000, headway: 300, phase: 0 } ]
	};

}
