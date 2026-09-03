import { describe, expect, it } from 'vitest';
import { transitVehiclesAt } from '../../../../connections/src/index.ts';
import { TransitJourney, tripIdentity } from './TransitJourney.js';

describe( 'TransitJourney', () => {

	for ( const mode of [
		{ kind: 'bus', placeKind: 'bus-stop', first: 'b0', second: 'b1', third: 'b2', y: 0, z: 0 },
		{ kind: 'train', placeKind: 'train-station', first: 't0', second: 't1', third: 't2', y: 0, z: 20 },
		{ kind: 'subway', placeKind: 'subway-station', first: 's0', second: 's1', third: 's2', y: -12, z: 40 }
	] ) {

		it( `boards, travels and disembarks by exact ${mode.kind} timetable geometry`, () => {

			const route = transitRoute( mode );
			const journey = new TransitJourney( { atlas: city(), routes: [ route ] } );
			const origin = { kind: mode.placeKind, id: mode.first };
			const position = [ 0, mode.y, mode.z ];
			const listed = journey.listBoardable( { position, place: origin, daySeconds: 1005 } );

			expect( listed.ok ).toBe( true );
			expect( listed.services ).toEqual( [ expect.objectContaining( {
				routeId: route.id,
				lineId: route.lineId,
				kind: mode.kind,
				stopId: mode.first,
				nextStopId: mode.second,
				destinationStopId: mode.third,
				arrivalTime: 1000,
				departureTime: 1010,
				position
			} ) ] );

			const boarded = journey.board( boardRequest( listed.services[ 0 ], origin, position, 1005 ) );
			expect( boarded.ok ).toBe( true );
			expect( boarded.state.status ).toBe( 'aboard' );

			const travelling = journey.update( { daySeconds: 1060 } );
			const [ exact ] = transitVehiclesAt( [ route ], 1060 );
			expect( travelling ).toEqual( expect.objectContaining( {
				ok: true,
				position: exact.position,
				heading: exact.heading,
				canDisembark: false
			} ) );
			expect( travelling.nextStops.map( ( stop ) => stop.stopId ) ).toEqual( [ mode.second, mode.third ] );
			expect( journey.disembark( { daySeconds: 1060 } ) ).toEqual( {
				ok: false, error: 'E_TRANSIT_MOVING_VEHICLE'
			} );

			const arrived = journey.update( { daySeconds: 1115 } );
			expect( arrived.canDisembark ).toBe( true );
			const left = journey.disembark( { daySeconds: 1115 } );
			expect( left ).toEqual( expect.objectContaining( {
				ok: true,
				place: { kind: mode.placeKind, id: mode.second },
				position: [ 100, mode.y, mode.z ],
				state: expect.objectContaining( { status: 'waiting' } )
			} ) );

		} );

	}

	it( 'rejects reach, route, place, service and timing mismatches with closed errors', () => {

		const route = transitRoute( { kind: 'bus', first: 'b0', second: 'b1', third: 'b2', y: 0, z: 0 } );
		const origin = { kind: 'bus-stop', id: 'b0' };
		const service = serviceChoice( route );

		expect( new TransitJourney( { atlas: city(), routes: [ route ] } )
			.listBoardable( { position: [ 20, 0, 0 ], place: origin, daySeconds: 1005 } ).services ).toEqual( [] );
		expect( new TransitJourney( { atlas: city(), routes: [ route ] } )
			.board( boardRequest( service, origin, [ 20, 0, 0 ], 1005 ) ).error ).toBe( 'E_TRANSIT_OUT_OF_REACH' );
		expect( new TransitJourney( { atlas: city(), routes: [ route ] } )
			.board( boardRequest( service, origin, [ 0, 0, 0 ], 1060 ) ).error ).toBe( 'E_TRANSIT_MISSED_VEHICLE' );
		expect( new TransitJourney( { atlas: city(), routes: [ route ] } )
			.board( boardRequest( { ...service, stopIndex: 1 }, { kind: 'bus-stop', id: 'b1' }, [ 100, 0, 0 ], 1060 ) ).error )
			.toBe( 'E_TRANSIT_MOVING_VEHICLE' );
		expect( new TransitJourney( { atlas: city(), routes: [ route ] } )
			.board( { ...boardRequest( service, origin, [ 0, 0, 0 ], 1005 ), routeId: 'absent' } ).error )
			.toBe( 'E_TRANSIT_ABSENT_ROUTE' );
		expect( new TransitJourney( { atlas: city(), routes: [ route ] } )
			.board( boardRequest( service, { kind: 'train-station', id: 't0' }, [ 0, 0, 20 ], 1005 ) ).error )
			.toBe( 'E_TRANSIT_WRONG_PLACE' );
		expect( new TransitJourney( { atlas: city(), routes: [ route ] } )
			.board( boardRequest( { ...service, serviceDeparture: 1001 }, origin, [ 0, 0, 0 ], 1005 ) ).error )
			.toBe( 'E_TRANSIT_OUT_OF_SERVICE' );

	} );

	it( 'carries a scheduled trip across the clock midnight', () => {

		const route = transitRoute(
			{ kind: 'bus', first: 'b0', second: 'b1', third: 'b2', y: 0, z: 0 },
			{ start: 86395, end: 87000, headway: 600, phase: 0 }
		);
		const journey = new TransitJourney( { atlas: city(), routes: [ route ] } );
		const origin = { kind: 'bus-stop', id: 'b0' };
		const listed = journey.listBoardable( { position: [ 0, 0, 0 ], place: origin, daySeconds: 5 } );

		expect( listed.services[ 0 ].serviceDeparture ).toBe( 86395 );
		expect( listed.services[ 0 ].tripId ).toBe( tripIdentity( route.id, 86395 ) );
		expect( journey.board( boardRequest( listed.services[ 0 ], origin, [ 0, 0, 0 ], 5 ) ).ok ).toBe( true );
		const travelling = journey.update( { daySeconds: 60 } );
		expect( travelling.ok ).toBe( true );
		expect( travelling.position[ 0 ] ).toBeCloseTo( 55, 9 );
		expect( travelling.position.slice( 1 ) ).toEqual( [ 0, 0 ] );
		expect( travelling.canDisembark ).toBe( false );
		expect( journey.disembark( { daySeconds: 110 } ) ).toEqual( expect.objectContaining( {
			ok: true,
			position: [ 100, 0, 0 ]
		} ) );

	} );

	it( 'replays the same active serialized state without position drift', () => {

		const route = transitRoute( { kind: 'train', first: 't0', second: 't1', third: 't2', y: 0, z: 20 } );
		const origin = { kind: 'train-station', id: 't0' };
		const first = new TransitJourney( { atlas: city(), routes: [ route ] } );
		first.board( boardRequest( serviceChoice( route ), origin, [ 0, 0, 20 ], 1005 ) );
		const saved = JSON.parse( JSON.stringify( first.state ) );
		const replayA = new TransitJourney( { atlas: city(), routes: [ route ], state: saved } );
		const replayB = new TransitJourney( { atlas: city(), routes: [ route ], state: saved } );

		expect( replayA.update( { daySeconds: 1075 } ) ).toEqual( replayB.update( { daySeconds: 1075 } ) );

	} );

	it( 'fails closed when route data or restored state is invalid', () => {

		const route = transitRoute( { kind: 'bus', first: 'b0', second: 'b1', third: 'b2', y: 0, z: 0 } );
		const malformed = { ...route, template: [ route.template[ 0 ] ] };
		const journey = new TransitJourney( { atlas: city(), routes: [ malformed ] } );

		expect( journey.listBoardable( {
			position: [ 0, 0, 0 ], place: { kind: 'bus-stop', id: 'b0' }, daySeconds: 1005
		} ) ).toEqual( { ok: false, error: 'E_TRANSIT_INVALID_DATA' } );
		expect( new TransitJourney( { atlas: city(), routes: [ route ], state: { status: 'aboard' } } )
			.update( { daySeconds: 1005 } ) ).toEqual( { ok: false, error: 'E_TRANSIT_INVALID_DATA' } );

	} );

} );

function city() {

	return {
		transit: {
			busStops: [ stop( 'b0', 0, 0 ), stop( 'b1', 100, 0 ), stop( 'b2', 200, 0 ) ],
			trainStations: [ station( 't0', 0, 20, 0 ), station( 't1', 100, 20, 0 ), station( 't2', 200, 20, 0 ) ],
			subwayStations: [
				station( 's0', 0, 40, -12 ), station( 's1', 100, 40, -12 ), station( 's2', 200, 40, -12 )
			]
		}
	};

}

function stop( id, x, z ) {

	return { id, position: [ x, z ] };

}

function station( id, x, z, level ) {

	return { id, position: [ x, z ], level };

}

function transitRoute( mode, service = { start: 1000, end: 2000, headway: 300, phase: 0 } ) {

	return {
		id: `route-${mode.kind}`,
		kind: mode.kind,
		lineId: `line-${mode.kind}`,
		stops: [
			{ stopId: mode.first, x: 0, y: mode.y, z: mode.z, shapeDist: 0 },
			{ stopId: mode.second, x: 100, y: mode.y, z: mode.z, shapeDist: 100 },
			{ stopId: mode.third, x: 200, y: mode.y, z: mode.z, shapeDist: 200 }
		],
		shape: [ [ 0, mode.y, mode.z ], [ 100, mode.y, mode.z ], [ 200, mode.y, mode.z ] ],
		template: [ { arrive: 0, depart: 10 }, { arrive: 110, depart: 120 }, { arrive: 220, depart: 220 } ],
		service: [ service ]
	};

}

function serviceChoice( route ) {

	return {
		tripId: tripIdentity( route.id, route.service[ 0 ].start ),
		routeId: route.id,
		stopIndex: 0,
		serviceDeparture: route.service[ 0 ].start
	};

}

function boardRequest( service, place, position, daySeconds ) {

	return {
		position,
		place,
		daySeconds,
		tripId: tripIdentity( service.routeId, service.serviceDeparture ),
		routeId: service.routeId,
		stopIndex: service.stopIndex,
		serviceDeparture: service.serviceDeparture
	};

}
