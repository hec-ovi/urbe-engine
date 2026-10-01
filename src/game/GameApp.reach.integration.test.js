import { beforeAll, describe, expect, it } from 'vitest';
import { expandBuilding, generate, makePlacementFixture } from '../../../interior/src/index.ts';
import { companionReach } from './GameApp.js';
import { buildingAnchors } from './agents/Anchors.js';
import { homesOf } from './sim/Homes.js';
import { roomAt, roomsOf } from './agents/interior-walls.test-fixtures.js';

let tower;

beforeAll( async () => {

	const interior = await generate( makePlacementFixture( { width: 24, depth: 32, floors: 4, type: 'residential', tier: 'high_rich', seed: 11 } ) );
	const { npc } = expandBuilding( interior );
	const anchors = buildingAnchors( npc, interior ).map( ( anchor ) => ( { id: anchor.id, kind: anchor.kind, floor: anchor.floor, position: anchor.position.toArray(), heading: anchor.heading } ) );
	tower = { interior, npc, anchors, homes: homesOf( { interior } ) };

}, 120000 );

/** A real Interior tower as GameApp gives it to the companion: its circulation, a resident's own seat, a worker's post and the free seats nearby. */
describe( 'where the companion sends people in a real building', () => {

	it( 'seats a resident sent home in their own numbered apartment, on its floor, inside its rooms', () => {

		const reach = reachOf();
		let seated = 0;
		for ( const home of tower.homes ) {

			const spot = reach.homeSpot( { home: { parcelId: 'p1', apartment: { id: home.id, number: home.number, floor: home.floor } } } );
			if ( ! spot ) continue;
			seated ++;
			const elevation = tower.interior.building.floors.find( ( floor ) => floor.index === home.floor ).elevation;
			expect( spot ).toMatchObject( { parcelId: 'p1', floor: home.floor, seated: true } );
			// The seated origin stands where the body's frame sits, a little under the floor it is on.
			expect( spot.position[ 1 ] ).toBeGreaterThan( elevation - 0.5 );
			expect( spot.position[ 1 ] ).toBeLessThan( elevation + 1 );
			const room = roomAt( roomsOf( tower.interior, home.floor ), spot.position, 0.4 );
			expect( home.rooms, `seat of ${home.number}` ).toContain( `floor:${home.floor}/${room}` );

		}
		expect( seated ).toBeGreaterThanOrEqual( tower.homes.length / 2 );
		expect( reach.homeSpot( { home: { parcelId: 'p1' } } ) ).toBeNull();
		expect( reach.homeSpot( { home: { parcelId: 'p1', apartment: { id: 'floor:9/nowhere' } } } ) ).toBeNull();

	} );

	it( 'stands a worker at the post their role keeps, the first slot of it as the simulation works it, and has none for a role the building does not keep', () => {

		const reach = reachOf();
		const roles = ( tower.npc.roles ?? [] ).filter( ( role, index, all ) => all.findIndex( ( other ) => other.role === role.role ) === index );
		expect( roles.length ).toBeGreaterThan( 0 );
		for ( const role of roles ) {

			const anchor = tower.anchors.find( ( entry ) => entry.id === role.homeAnchor );
			const spot = reach.workSpot( { job: { parcelId: 'p1', role: role.role } } );
			if ( ! anchor ) {

				expect( spot ).toBeNull();
				continue;

			}
			expect( spot ).toEqual( { position: anchor.position, parcelId: 'p1', floor: anchor.floor, heading: anchor.heading } );

		}
		expect( reach.workSpot( { job: { parcelId: 'p1', role: 'astronaut' } } ) ).toBeNull();
		expect( reach.workSpot( {} ) ).toBeNull();

	} );

	it( 'sits a person on the nearest free seat on their floor, passing over one somebody on an errand already holds', () => {

		const home = tower.homes.find( ( entry ) => reachOf().homeSpot( { home: { parcelId: 'p1', apartment: { id: entry.id } } } ) );
		const first = reachOf().homeSpot( { home: { parcelId: 'p1', apartment: { id: home.id } } } );
		const actor = { place: { kind: 'parcel', id: 'p1', floor: home.floor }, position: [ first.position[ 0 ] + 0.6, first.position[ 1 ], first.position[ 2 ] ] };
		const nearest = reachOf().seat( actor );
		expect( nearest ).toMatchObject( { parcelId: 'p1', floor: home.floor, seated: true } );
		const seats = tower.anchors.filter( ( anchor ) => anchor.kind === 'seat' && Math.abs( anchor.position[ 1 ] - actor.position[ 1 ] ) < 1.5 );
		const metres = ( anchor ) => Math.hypot( anchor.position[ 0 ] - actor.position[ 0 ], anchor.position[ 2 ] - actor.position[ 2 ] );
		expect( Math.hypot( nearest.position[ 0 ] - actor.position[ 0 ], nearest.position[ 2 ] - actor.position[ 2 ] ) ).toBeCloseTo( Math.min( ...seats.map( metres ) ), 6 );

		const held = reachOf( { errandsUnderway: [ { npcId: 'other' } ], actor: () => ( { position: nearest.position } ) } ).seat( actor );
		expect( held?.position ).not.toEqual( nearest.position );
		expect( reachOf().seat( { place: { kind: 'edge', id: 'walk' }, position: actor.position } ) ).toBeNull();

	} );

	it( 'reads the building\'s circulation for a talk while the building streams in or out', () => {

		const plan = reachOf().plan( 'p1' );
		expect( plan.apartments.map( ( apartment ) => apartment.number ) ).toEqual( tower.homes.map( ( home ) => home.number ) );
		expect( plan.floors.every( ( floor ) => floor.lifts.length + floor.stairs.length > 0 ) ).toBe( true );
		expect( reachOf().plan( 'p2' ) ).toBeNull();

	} );

} );

function reachOf( continuity = { errandsUnderway: [], actor: () => null } ) {

	return companionReach( {
		buildings: new Map( [ [ 'p1', { npc: tower.npc, interior: tower.interior } ] ] ),
		places: [ { kind: 'parcel', id: 'p1', anchors: tower.anchors } ],
		interiorRoutes: { plan: () => null },
		continuity
	} );

}
