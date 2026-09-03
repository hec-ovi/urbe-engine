import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { TransitGameplay, transitServiceLabel } from './TransitGameplay.js';
import { Locator } from '../world/Locator.js';

describe( 'TransitGameplay', () => {

	for ( const mode of [
		{ kind: 'bus', placeKind: 'bus-stop', ids: [ 'b0', 'b1', 'b2' ], y: 0, z: 0 },
		{ kind: 'train', placeKind: 'train-station', ids: [ 't0', 't1', 't2' ], y: 0, z: 20 },
		{ kind: 'subway', placeKind: 'subway-station', ids: [ 's0', 's1', 's2' ], y: -12, z: 40 }
	] ) it( `drives the player through a ${mode.kind} ride and restores control at the published place`, () => {

		const atlas = city();
		const route = transitRoute( mode );
		const { gameplay, controller } = harness( atlas, [ route ], [ 0, mode.y, mode.z ] );
		const waiting = gameplay.update( { daySeconds: 1005 } );
		expect( waiting.prompt ).toContain( `board ${mode.kind === 'bus' ? 'Bus' : mode.kind === 'train' ? 'Train' : 'Subway'}` );
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

	it( 'leaves a higher-priority world interaction on E and offers an explicit choice for a tie', () => {

		const atlas = city();
		const routes = [
			transitRoute( { kind: 'bus', ids: [ 'b0', 'b1', 'b2' ], y: 0, z: 0 } ),
			{ ...transitRoute( { kind: 'bus', ids: [ 'b0', 'b2', 'b1' ], y: 0, z: 0 } ), id: 'route-bus-2', lineId: 'line-bus-2' }
		];
		const { gameplay } = harness( atlas, routes, [ 0, 0, 0 ] );

		expect( gameplay.update( { daySeconds: 1005, interactionBlocked: true } ).prompt ).toBeNull();
		const waiting = gameplay.update( { daySeconds: 1005 } );
		expect( waiting.services ).toHaveLength( 2 );
		expect( gameplay.activate() ).toMatchObject( { action: 'choose', services: waiting.services } );
		expect( gameplay.board( waiting.services[ 1 ] ).result.ok ).toBe( true );

	} );

	it( 'rejects a stale restored trip without moving the player and continues from waiting state', () => {

		const atlas = city();
		const route = transitRoute( { kind: 'bus', ids: [ 'b0', 'b1', 'b2' ], y: 0, z: 0 } );
		const stale = {
			status: 'aboard', clock: { dayOffset: 0, lastDaySeconds: 1005 },
			tripId: 'trip:7:missing:1000', routeId: 'missing', serviceDeparture: 1000, boardedStopIndex: 0
		};
		const { gameplay, controller } = harness( atlas, [ route ], [ 0, 0, 0 ], stale );

		expect( gameplay.restoreRejected ).toBe( true );
		expect( gameplay.state.status ).toBe( 'waiting' );
		expect( controller.begins ).toBe( 0 );
		expect( gameplay.update( { daySeconds: 1005 } ).services ).toHaveLength( 1 );

	} );

	it( 'names a service with its mode, line, destination and current departure', () => {

		expect( transitServiceLabel( {
			kind: 'subway', lineId: 'S4', destinationStopId: 'central', departureTime: 3661
		} ) ).toBe( 'Subway S4 to central, departs 01:01:01' );

	} );

} );

function harness( atlas, routes, position, state ) {

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
		gameplay: new TransitGameplay( { atlas, routes, state, locator: new Locator( atlas, routes ), controller } )
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
