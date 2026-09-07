import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { StationAccess } from './StationAccess.js';
import { StationTravel } from './StationTravel.js';
import { TransitGameplay } from './TransitGameplay.js';
import { TransitJourneyBoundary } from './TransitJourneyBoundary.js';
import { Locator } from '../world/Locator.js';
import { stationCity, stationRoute } from './station.test-fixtures.js';

describe( 'station destination terminals', () => {

	it( 'offers named destinations only along a published directed route', () => {

		const atlas = stationCity(), route = stationRoute( atlas );
		const boundary = new TransitJourneyBoundary();
		expect( boundary.valid( 'transit-data', { atlas, routes: [ route ] } ) ).toBe( true );
		const travel = new StationTravel( atlas, [ route ] );
		const [ origin, destination, unconnected ] = new StationAccess( atlas ).entrances;
		const choices = travel.choices( origin.arrival );
		expect( choices ).toEqual( [ {
			originId: origin.id, destinationId: destination.id, routeId: route.id,
			stationName: 'Cinder Terminus', lineId: 'Quiet Line'
		} ] );
		expect( boundary.valid( 'station-travel#/$defs/selection', choices[ 0 ] ) ).toBe( true );
		expect( travel.choices( destination.arrival ) ).toEqual( [] );
		expect( travel.choices( unconnected.arrival ) ).toEqual( [] );
		const unreachable = travel.travel( { ...choices[ 0 ], destinationId: unconnected.id }, origin.arrival );
		expect( unreachable ).toEqual( { ok: false, error: 'E_TRANSIT_ABSENT_ROUTE' } );
		expect( boundary.valid( 'station-travel#/$defs/result', unreachable ) ).toBe( true );
		expect( travel.travel( { ...choices[ 0 ], extra: true }, origin.arrival ) ).toEqual( { ok: false, error: 'E_TRANSIT_INVALID_DATA' } );

	} );

	it( 'asks even for one destination and arrives on the target landing facing the street stairs', () => {

		const { gameplay, controller, destination } = harness();
		const boundary = new TransitJourneyBoundary();
		const frame = gameplay.update( { daySeconds: 4000 } );
		expect( frame.prompt ).toBe( 'E  choose destination' );
		expect( boundary.valid( 'gameplay-view', frame ) ).toBe( true );
		const picker = gameplay.activate();
		expect( picker.action ).toBe( 'choose-destination' );
		expect( picker.destinations ).toHaveLength( 1 );
		expect( boundary.valid( 'gameplay-action', picker ) ).toBe( true );
		expect( controller.moves ).toBe( 0 );
		const action = gameplay.selectDestination( picker.destinations[ 0 ] );
		expect( action ).toMatchObject( { action: 'station-travel', result: { ok: true, destinationStationId: 's1' } } );
		expect( boundary.valid( 'gameplay-action', action ) ).toBe( true );
		expect( boundary.valid( 'station-travel#/$defs/result', action.result ) ).toBe( true );
		expect( controller.body.feet.toArray() ).toEqual( destination.arrival );
		const forward = new THREE.Vector3( - Math.sin( controller.yaw ), 0, - Math.cos( controller.yaw ) );
		const towardStairs = new THREE.Vector3( destination.origin[ 0 ] - destination.arrival[ 0 ], 0, destination.origin[ 1 ] - destination.arrival[ 2 ] ).normalize();
		expect( forward.dot( towardStairs ) ).toBeCloseTo( 1, 6 );
		expect( gameplay.state.status ).toBe( 'waiting' );
		expect( controller.movementLocked ).toBe( false );
		expect( controller.moves ).toBe( 1 );

	} );

	it( 'rechecks live feet and rejects wrong floors, departed terminals and cancelled selections', () => {

		const { gameplay, controller, origin } = harness();
		const choose = () => { gameplay.update( { daySeconds: 1005 } ); return gameplay.activate().destinations[ 0 ]; };
		let choice = choose();
		controller.body.feet.y += 2;
		expect( gameplay.selectDestination( choice ).result ).toEqual( { ok: false, error: 'E_TRANSIT_OUT_OF_REACH' } );
		expect( controller.body.feet.y ).toBe( origin.arrival[ 1 ] + 2 );
		controller.body.feet.fromArray( origin.arrival );
		choice = choose();
		controller.body.feet.x += 10;
		expect( gameplay.selectDestination( choice ).result ).toEqual( { ok: false, error: 'E_TRANSIT_OUT_OF_REACH' } );
		controller.body.feet.fromArray( origin.arrival );
		choice = choose();
		gameplay.cancelSelection();
		expect( gameplay.selectDestination( choice ).result ).toEqual( { ok: false, error: 'E_TRANSIT_INVALID_DATA' } );
		expect( controller.moves ).toBe( 0 );
		expect( controller.body.feet.toArray() ).toEqual( origin.arrival );
		const blocked = gameplay.update( { daySeconds: 1005, interactionBlocked: true } );
		expect( blocked.prompt ).toBeNull();
		expect( gameplay.activate() ).toBeNull();

	} );

	it( 'fails closed for malformed routes on admission and after a destination is offered', () => {

		const atlas = stationCity(), invalid = stationRoute( atlas );
		invalid.stops[ 1 ].stopId = 'unpublished';
		expect( new StationTravel( atlas, [ invalid ] ).choices( new StationAccess( atlas ).entrances[ 0 ].arrival ) ).toEqual( [] );
		const { gameplay, controller, route, origin } = harness();
		gameplay.update( { daySeconds: 1005 } );
		const choice = gameplay.activate().destinations[ 0 ];
		route.shape = [ route.shape[ 0 ] ];
		expect( gameplay.selectDestination( choice ).result.ok ).toBe( false );
		expect( controller.moves ).toBe( 0 );
		expect( controller.body.feet.toArray() ).toEqual( origin.arrival );
		expect( gameplay.state.status ).toBe( 'waiting' );

	} );

} );

function harness() {

	const atlas = stationCity(), route = stationRoute( atlas );
	const [ origin, destination ] = new StationAccess( atlas ).entrances;
	const controller = { body: { feet: new THREE.Vector3( ...origin.arrival ) }, movementLocked: false, moves: 0,
		endRide( position ) { this.body.feet.fromArray( position ); this.movementLocked = false; this.moves ++; } };
	const gameplay = new TransitGameplay( { atlas, routes: [ route ], controller, locator: new Locator( atlas, [ route ] ) } );
	return { gameplay, controller, origin, destination, route };

}
