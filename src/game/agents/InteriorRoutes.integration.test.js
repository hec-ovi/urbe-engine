import { beforeAll, describe, expect, it } from 'vitest';
import { expandBuilding, generate, makePlacementFixture } from '../../../../interior/src/index.ts';
import { findPath } from '../../../../interior/src/nav.ts';
import { InteriorRoutes } from './InteriorRoutes.js';
import { roomAt, roomsOf, streetDoor, walls } from './interior-walls.test-fixtures.js';

/** Two residential towers as Interior furnishes them: apartments off a corridor, a lift and stairs to every floor. */
const TOWERS = [
	{ width: 24, depth: 32, floors: 4, type: 'residential', tier: 'high_rich', seed: 11 },
	{ width: 40, depth: 40, floors: 6, type: 'residential', tier: 'high_rich', seed: 5 }
];
const towers = [];

beforeAll( async () => {

	for ( const options of TOWERS ) {

		const interior = await generate( makePlacementFixture( options ) );
		const { npc } = expandBuilding( interior );
		const routes = new InteriorRoutes( new Map( [ [ 'p1', { npc, interior } ] ] ), { findPath } );
		towers.push( { interior, routes, plan: routes.plan( 'p1' ) } );

	}

}, 120000 );

/**
 * The way a guide or an errand walks a real building from its street door to
 * a home: over Interior's own navigation, checked against the rooms and doors
 * the building draws, so nobody walks through a wall or a closed door.
 */
describe( 'walking a real building to an apartment', () => {

	it( 'reaches every numbered apartment door from the street door, up a lift or the stairs, never through a wall', () => {

		for ( const { interior, routes, plan } of towers ) {

			const street = streetDoor( interior );
			expect( plan.apartments.length ).toBeGreaterThanOrEqual( 4 );
			for ( const apartment of plan.apartments ) {

				const route = routes.route( 'p1', street, apartment.front );
				expect( route, `apartment ${apartment.number}` ).not.toBeNull();
				expect( route.path3[ 0 ] ).toEqual( street );
				expect( route.path3.at( - 1 ) ).toEqual( apartment.front );
				walls( interior, route.path3, `to apartment ${apartment.number}` );
				climbs( interior, route, apartment.floor );
				// The corridor side of the door: no apartment door is walked through on the way.
				expect( ( route.gates ?? [] ).filter( ( gate ) => gate.kind === 'door' ) ).toEqual( [] );

			}

		}

	} );

	it( 'walks into each apartment through its own door, asking it open, to every room of the home', () => {

		for ( const { interior, routes, plan } of towers ) {

			for ( const apartment of plan.apartments ) {

				const rooms = plan.floors.find( ( floor ) => floor.index === apartment.floor ).rooms.filter( ( room ) => room.unit === apartment.unit );
				expect( rooms.length, `apartment ${apartment.number}` ).toBeGreaterThan( 0 );
				for ( const room of rooms ) {

					const route = routes.route( 'p1', apartment.front, room.position );
					expect( route, `${room.kind} of ${apartment.number}` ).not.toBeNull();
					walls( interior, route.path3, `into ${room.kind} of ${apartment.number}` );
					const doors = ( route.gates ?? [] ).filter( ( gate ) => gate.kind === 'door' );
					expect( doors ).toEqual( [ expect.objectContaining( { kind: 'door', parcelId: 'p1', floor: apartment.floor, position: apartment.door } ) ] );
					expect( doors[ 0 ].at ).toBeGreaterThan( 0 );

				}

			}

		}

	} );

	it( 'catches a straight walk through the walls, so the checks above hold', () => {

		const [ { interior, plan } ] = towers;
		const street = streetDoor( interior );
		const straight = plan.floors[ 0 ].rooms.filter( ( room ) => {

			try {

				walls( interior, [ street, room.position ], 'straight' );
				return false;

			} catch {

				return true;

			}

		} );
		expect( straight.length ).toBeGreaterThan( 0 );

	} );

	it( 'reads each floor\'s lift and stairs where the building draws its shaft and stair rooms', () => {

		for ( const { interior, plan } of towers ) {

			for ( const floor of plan.floors ) {

				const rooms = roomsOf( interior, floor.index );
				for ( const lift of floor.lifts ) expect( roomAt( rooms, lift.position ), `lift landing ${lift.id} on ${floor.index}` ).not.toBeNull();
				for ( const stair of floor.stairs ) expect( roomAt( rooms, stair.position ), `stair ${stair.id} on ${floor.index}` ).not.toBeNull();
				expect( floor.lifts.length + floor.stairs.length ).toBeGreaterThan( 0 );

			}

		}

	} );

} );

/** Off its floors the path is only on a stair or in a lift car, and a lift is a gate ridden to the apartment's floor. */
function climbs( interior, route, floor ) {

	const levels = interior.building.floors.map( ( entry ) => entry.elevation );
	const target = interior.building.floors.find( ( entry ) => entry.index === floor ).elevation;
	expect( route.path3.at( - 1 )[ 1 ] ).toBeCloseTo( target, 6 );
	const lifts = ( route.gates ?? [] ).filter( ( gate ) => gate.kind === 'lift' );
	for ( const lift of lifts ) expect( lift ).toMatchObject( { parcelId: 'p1', fromFloor: 0, toFloor: floor } );
	const between = route.path3.filter( ( point ) => ! levels.some( ( level ) => Math.abs( level - point[ 1 ] ) < 0.01 ) );
	if ( floor > 0 ) expect( lifts.length + between.length ).toBeGreaterThan( 0 );
	for ( const point of between ) {

		const below = interior.building.floors.filter( ( entry ) => entry.elevation < point[ 1 ] ).at( - 1 );
		const room = roomAt( roomsOf( interior, below.index ), [ point[ 0 ], point[ 2 ] ], 0.3 );
		expect( room, `climbing at ${point}` ).toMatch( /^(stair|elev)/ );

	}
	if ( ! lifts.length && floor > 0 ) {

		const rises = route.path3.slice( 1 ).map( ( point, index ) => point[ 1 ] - route.path3[ index ][ 1 ] );
		expect( Math.max( ...rises ) ).toBeLessThanOrEqual( 0.25 );

	}

}
