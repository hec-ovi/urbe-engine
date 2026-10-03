import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from './schema/access.schema.json' with { type: 'json' };
import {
	AddressBook, PlayerAccess, PlayerItems, Regard, accessLines, cardFor, describeScope, floorLabel, givesCard, grants,
	notices, parseScope, roomNumber, scopeOfDoor, scopesOf
} from './index.js';

const square = ( x0, z0, x1, z1 ) => [ [ x0, z0 ], [ x1, z0 ], [ x1, z1 ], [ x0, z1 ] ];

/**
 * A home block: a lobby with a store off it on the ground floor, then two
 * home floors of one layout with two dwellings each off a corridor along
 * z 0..2; homes stand south of it, their doors on the corridor wall at z 2.
 */
const homes = {
	npc: {
		roles: [ { id: 'desk', role: 'receptionist', floor: 0, homeAnchor: 'a-desk', count: [ 1, 1 ] } ],
		anchors: [ { id: 'a-desk', floor: 0, room: 'floor:0/f0-lobby', kind: 'work_spot', position: [ 5, 5 ], facingDeg: 0 } ]
	},
	interior: {
		building: {
			floors: [
				{ index: 0, layout: 'ground', elevation: 0, openings: {} },
				{ index: 1, layout: 'middle', elevation: 4, openings: {}, apartmentEntrances: [
					{ unit: 'f1-home-1', number: '101', position: [ 5, 2 ], inward: [ 0, 1 ], width: 1.6 },
					{ unit: 'f1-home-2', number: '102', position: [ 15, 2 ], inward: [ 0, 1 ], width: 1.6 }
				] },
				{ index: 2, layout: 'middle', elevation: 8, openings: {}, apartmentEntrances: [
					{ unit: 'f1-home-1', number: '201', position: [ 5, 2 ], inward: [ 0, 1 ], width: 1.6 },
					{ unit: 'f1-home-2', number: '202', position: [ 15, 2 ], inward: [ 0, 1 ], width: 1.6 }
				] }
			]
		},
		layouts: {
			ground: { floor: { kind: 'lobby', rooms: [
				{ id: 'f0-lobby', kind: 'reception', polygon: square( 0, 0, 20, 10 ), doors: [] },
				{ id: 'f0-store', kind: 'storage', polygon: square( 20, 0, 24, 4 ), doors: [ { id: 'd1', to: 'f0-lobby', leaves: 1, width: 0.9, position: [ 20, 2 ], angleDeg: 90 } ] },
				{ id: 'stair-a', kind: 'corridor', polygon: square( 24, 0, 28, 4 ), doors: [] }
			] } },
			middle: { floor: { kind: 'apartment', rooms: [
				{ id: 'f1-corridor', kind: 'corridor', polygon: square( 0, 0, 20, 2 ), doors: [] },
				{ id: 'f1-r1', kind: 'living', unit: 'f1-home-1', polygon: square( 0, 2, 10, 10 ), doors: [] },
				{ id: 'f1-r2', kind: 'living', unit: 'f1-home-2', polygon: square( 10, 2, 20, 10 ), doors: [] }
			] } }
		}
	}
};

/** An office tower: a reception on the ground floor and an office floor with an archive, a server room and an office. */
const offices = {
	npc: { roles: [
		{ id: 'clerk', role: 'office_worker', floor: 3, homeAnchor: 'a-clerk', count: [ 1, 4 ] },
		{ id: 'guard', role: 'security', floor: 0, homeAnchor: 'a-guard', count: [ 1, 1 ] }
	], anchors: [
		{ id: 'a-clerk', floor: 3, room: 'floor:3/f3-r9', kind: 'work_spot', position: [ 32, 6 ], facingDeg: 0 },
		{ id: 'a-guard', floor: 0, room: 'floor:0/f0-r2', kind: 'work_spot', position: [ 10, 5 ], facingDeg: 0 }
	] },
	interior: {
		building: { floors: [
			{ index: 0, layout: 'ground', elevation: 0, openings: {} },
			{ index: 3, layout: 'middle', elevation: 12, openings: {} }
		] },
		layouts: {
			ground: { floor: { kind: 'lobby', rooms: [ { id: 'f0-r2', kind: 'reception', polygon: square( 0, 0, 20, 10 ), doors: [] } ] } },
			middle: { floor: { kind: 'office', rooms: [
				{ id: 'f3-r2', kind: 'office_open', polygon: square( 0, 0, 30, 10 ), doors: [] },
				{ id: 'f3-r8', kind: 'storage', role: 'archive', polygon: square( 0, 10, 5, 14 ), doors: [ { id: 'd8', to: 'f3-r2', leaves: 1, width: 0.9, position: [ 2.5, 10 ], angleDeg: 0 } ] },
				{ id: 'f3-r6', kind: 'meeting', role: 'server', polygon: square( 5, 10, 10, 14 ), doors: [ { id: 'd6', to: 'f3-r2', leaves: 1, width: 0.9, position: [ 7.5, 10 ], angleDeg: 0 } ] },
				{ id: 'f3-r9', kind: 'office_private', polygon: square( 30, 0, 34, 10 ), doors: [ { id: 'd9', to: 'f3-r2', leaves: 1, width: 0.9, position: [ 30, 5 ], angleDeg: 90 } ] },
				{ id: 'f3-r1', kind: 'meeting', polygon: square( 10, 10, 15, 14 ), doors: [ { id: 'd1', to: 'f3-r2', leaves: 2, width: 1.2, position: [ 12.5, 10 ], angleDeg: 0 } ] }
			] } }
		}
	}
};

const book = () => new AddressBook( {
	buildings: new Map( [ [ 'p-homes', homes ], [ 'p-office', offices ] ] ),
	nameOf: ( parcelId ) => parcelId === 'p-homes' ? { name: 'Kessler Block', word: 'apartment block' } : { word: 'office building', street: 'Third Street' }
} );

describe( 'AddressBook', () => {

	it( 'addresses every dwelling by the number on its door and its floor, from the published entrances', () => {

		const building = book().building( 'p-homes' );
		const apartments = building.units.filter( ( unit ) => unit.kind === 'apartment' );
		expect( apartments.map( ( unit ) => unit.address ) ).toEqual( [
			'Kessler Block, floor 1, apartment 101', 'Kessler Block, floor 1, apartment 102',
			'Kessler Block, floor 2, apartment 201', 'Kessler Block, floor 2, apartment 202'
		] );
		const home = apartments[ 2 ];
		expect( home ).toMatchObject( { id: 'apartment:p-homes:floor:2/f1-home-1', floor: 2, display: 2, number: '201', label: 'apartment 201', short: 'Kessler Block 201', rooms: [ 'f1-r1' ], scope: 'home:p-homes/floor:2/f1-home-1' } );
		// The corridor side of the door, a step out of the dwelling at the floor's height.
		expect( home.doors[ 0 ].front[ 0 ] ).toBeCloseTo( 5 );
		expect( home.doors[ 0 ].front[ 1 ] ).toBe( 8 );
		expect( home.doors[ 0 ].front[ 2 ] ).toBeCloseTo( 1.1 );

	} );

	it( 'numbers the private rooms on each floor, ground floor and offices alike, and leaves shared rooms open', () => {

		const homeBlock = book().building( 'p-homes' );
		expect( homeBlock.units.filter( ( unit ) => unit.kind === 'room' ).map( ( unit ) => [ unit.address, unit.scope ] ) ).toEqual( [
			[ 'Kessler Block, ground floor, storage room G01', 'service:p-homes' ]
		] );
		const tower = book().building( 'p-office' );
		expect( tower.name ).toBe( 'the office building on Third Street' );
		expect( tower.units.map( ( unit ) => [ unit.label, unit.scope ] ) ).toEqual( [
			[ 'office 301', 'staff:p-office' ], [ 'archive 302', 'staff:p-office' ], [ 'server room 303', 'security:p-office' ]
		] );
		const archive = tower.units[ 1 ];
		// The door into the archive from the open office, its public side outside the room.
		expect( archive.doors ).toHaveLength( 1 );
		expect( archive.doors[ 0 ].inward[ 0 ] ).toBeCloseTo( 0 );
		expect( archive.doors[ 0 ].inward[ 1 ] ).toBeCloseTo( 1 );
		expect( floorLabel( 0 ) ).toBe( 'ground floor' );
		expect( floorLabel( - 2 ) ).toBe( 'basement 2' );
		expect( roomNumber( - 2, 1 ) ).toBe( 'B2-01' );

	} );

	it( 'says where a point stands, which home a person lives in and where they work, and finds a unit a line names', () => {

		const addresses = book();
		expect( addresses.at( 'p-homes', [ 6, 8.1, 6 ] ) ).toMatchObject( { floor: 2, display: 2, floorLabel: 'floor 2', room: 'living', label: 'apartment 201', address: 'Kessler Block, floor 2, apartment 201' } );
		expect( addresses.at( 'p-homes', [ 6, 4, 1 ] ) ).toMatchObject( { floor: 1, room: 'corridor', address: 'Kessler Block, floor 1, corridor' } );
		const resident = { home: { parcelId: 'p-homes', unit: 2, apartment: { id: 'floor:2/f1-home-1', floor: 2, number: '201' } } };
		expect( addresses.home( resident ).address ).toBe( 'Kessler Block, floor 2, apartment 201' );
		expect( addresses.work( { job: { parcelId: 'p-office', role: 'office_worker' } } ).address ).toBe( 'the office building on Third Street, floor 3, office 301' );
		expect( addresses.work( { job: { parcelId: 'p-homes', role: 'receptionist' } } ).address ).toBe( 'Kessler Block, ground floor, reception' );
		expect( addresses.find( 'Take me to apartment 202, please', [ 'p-homes' ] ).map( ( unit ) => unit.label ) ).toEqual( [ 'apartment 202' ] );
		expect( addresses.find( 'the archive, 302', [ 'p-office' ] ).map( ( unit ) => unit.label ) ).toEqual( [ 'archive 302' ] );
		expect( addresses.find( 'storage G01' ).map( ( unit ) => unit.label ) ).toEqual( [ 'storage room G01' ] );
		expect( addresses.find( 'no numbers here' ) ).toEqual( [] );

	} );

} );

describe( 'Access', () => {

	it( 'gives a person their home and their post\'s scopes, wider for the front desk and security', () => {

		const addresses = book();
		const resident = { home: { parcelId: 'p-homes', apartment: { id: 'floor:2/f1-home-1' } } };
		expect( scopesOf( resident, addresses ) ).toEqual( [ 'home:p-homes/floor:2/f1-home-1' ] );
		// A clerk opens the staff rooms; the building has no service rooms to open.
		expect( scopesOf( { ...resident, job: { parcelId: 'p-office', role: 'office_worker' } }, addresses ) )
			.toEqual( [ 'home:p-homes/floor:2/f1-home-1', 'staff:p-office' ] );
		expect( scopesOf( { job: { parcelId: 'p-office', role: 'security' } }, addresses ) ).toEqual( [ 'staff:p-office', 'security:p-office' ] );
		// The front desk of a home block holds its store and a master card for its homes.
		expect( scopesOf( { job: { parcelId: 'p-homes', role: 'receptionist' } }, addresses ) ).toEqual( [ 'service:p-homes', 'homes:p-homes' ] );

	} );

	it( 'opens a door by its own scope or by a master card for its building', () => {

		expect( parseScope( 'home:p-homes/floor:2/f1-home-1' ) ).toEqual( { kind: 'home', parcelId: 'p-homes', home: 'floor:2/f1-home-1' } );
		expect( parseScope( 'home:p-homes' ) ).toBeNull();
		expect( grants( new Set( [ 'homes:p-homes' ] ), 'home:p-homes/floor:2/f1-home-1' ) ).toBe( true );
		expect( grants( new Set( [ 'homes:p-other' ] ), 'home:p-homes/floor:2/f1-home-1' ) ).toBe( false );
		expect( grants( new Set(), null ) ).toBe( true );
		expect( scopeOfDoor( { role: 'apartment', parcelId: 'p-homes', floor: 2, unit: 'f1-home-1' } ) ).toBe( 'home:p-homes/floor:2/f1-home-1' );
		expect( scopeOfDoor( { parcelId: 'p-homes', name: 'Kessler Block' } ) ).toBeNull();

	} );

	it( 'makes a card of a scope: its label, issuer and what it opens', () => {

		const addresses = book();
		const card = cardFor( 'home:p-homes/floor:2/f1-home-1', { book: addresses, issuer: { npcId: 'npc-mara', name: 'Mara Kessler' }, atMin: 600 } );
		expect( card ).toEqual( {
			id: 'card:home:p-homes/floor:2/f1-home-1', kind: 'access-card', label: 'Kessler Block 201 key card',
			data: { grants: [ 'home:p-homes/floor:2/f1-home-1' ], access: 'Kessler Block, floor 2, apartment 201', issuer: { npcId: 'npc-mara', name: 'Mara Kessler' }, how: 'given', atMin: 600 }
		} );
		expect( describeScope( 'security:p-office', addresses ) ).toMatchObject( { label: 'Third Street security card', access: 'the security rooms of the office building on Third Street (server room 303)' } );
		expect( givesCard( 'friendly', 'home:p-homes/floor:2/f1-home-1' ) ).toBe( true );
		expect( givesCard( 'friendly', 'staff:p-office' ) ).toBe( false );
		for ( const disposition of [ 'neutral', 'wary', 'hostile' ] ) expect( givesCard( disposition, 'home:p-homes/floor:2/f1-home-1' ) ).toBe( false );

	} );

	it( 'keeps a locked door shut to the player until they carry its card, and never locks them in', () => {

		const addresses = book();
		const items = new PlayerItems();
		const access = new PlayerAccess( { items, book: addresses } );
		const door = { role: 'apartment', parcelId: 'p-homes', floor: 2, unit: 'f1-home-1', center: { x: 5, y: 8, z: 2 }, inward: [ 0, 1 ] };
		expect( access.lockOf( door, { x: 5, z: 1 } ) ).toEqual( { scope: 'home:p-homes/floor:2/f1-home-1', place: 'apartment 201', locked: true } );
		// From inside the dwelling the door opens.
		expect( access.lockOf( door, { x: 5, z: 3 } ).locked ).toBe( false );
		items.add( cardFor( 'home:p-homes/floor:2/f1-home-1', { book: addresses } ) );
		expect( access.lockOf( door, { x: 5, z: 1 } ).locked ).toBe( false );
		// A quest item that opens a door is a card too.
		const quest = new PlayerAccess( { items: new PlayerItems(), book: addresses, questCards: () => [ { id: 'archive-key', scope: 'staff:p-office' } ] } );
		expect( quest.holds( 'staff:p-office' ) ).toBe( true );
		expect( access.lockOf( { parcelId: 'p-homes', center: { x: 0, z: 0 } } ) ).toBeNull();

	} );

} );

describe( 'PlayerItems', () => {

	it( 'carries general items once each and saves them beside the quest items, taking back only its own kinds', () => {

		const items = new PlayerItems();
		const card = { id: 'card:staff:p-office', kind: 'access-card', label: 'Third Street staff card', data: { grants: [ 'staff:p-office' ] } };
		expect( items.add( card ) ).toBe( true );
		expect( items.add( { ...card, label: 'again' } ) ).toBe( false );
		expect( items.get( card.id ).label ).toBe( 'Third Street staff card' );
		const saved = items.serialize();
		expect( saved ).toEqual( [ { id: 'card:staff:p-office', name: 'Third Street staff card', quantity: 1, state: { kind: 'access-card', data: { grants: [ 'staff:p-office' ] } } } ] );
		const quest = { id: 'ledger', name: 'Ledger', quantity: 1, state: { kind: 'document' } };
		const back = new PlayerItems();
		expect( back.restore( [ quest, ...saved ] ) ).toEqual( [ quest ] );
		expect( back.ofKind( 'access-card' ) ).toEqual( [ { ...card, quantity: 1 } ] );
		expect( back.remove( card.id ) ).toBe( true );
		expect( back.size ).toBe( 0 );
		expect( () => items.add( { id: 'x' } ) ).toThrow();

	} );

} );

describe( 'Regard', () => {

	it( 'brings a person who caught the player down a step per theft, saved as its schema says', () => {

		const regard = new Regard();
		expect( regard.adjust( 'friendly', 'npc-mara' ) ).toBe( 'friendly' );
		regard.drop( 'npc-mara', 600 );
		expect( regard.adjust( 'friendly', 'npc-mara' ) ).toBe( 'neutral' );
		regard.drop( 'npc-mara', 610 );
		regard.drop( 'npc-mara', 620 );
		regard.drop( 'npc-mara', 630 );
		expect( regard.adjust( 'friendly', 'npc-mara' ) ).toBe( 'hostile' );
		const saved = { regard: regard.serialize() };
		expect( saved ).toEqual( { regard: [ { npcId: 'npc-mara', drop: 3, atMin: 630 } ] } );
		expect( new Ajv2020( { strict: true } ).compile( schema )( saved ) ).toBe( true );
		expect( new Regard().restore( saved.regard ).of( 'npc-mara' ) ).toBe( 3 );

	} );

	it( 'notices a hand in the pocket when facing the player, else by how watchful the person is', () => {

		expect( notices( { disposition: 'friendly', heading: 0, toPlayer: [ 0, 1 ], seed: 'x' } ) ).toBe( true );
		const behind = ( seed, disposition ) => notices( { disposition, heading: 0, toPlayer: [ 0, - 1 ], seed } );
		const caught = ( disposition ) => Array.from( { length: 400 }, ( _, i ) => behind( `s${i}`, disposition ) ).filter( Boolean ).length;
		expect( caught( 'hostile' ) ).toBeGreaterThan( caught( 'friendly' ) );
		expect( behind( 'same', 'neutral' ) ).toBe( behind( 'same', 'neutral' ) );

	} );

} );

describe( 'accessLines', () => {

	it( 'holds every line the asks, refusals, notices and prompts need', () => {

		const lines = accessLines();
		expect( lines.say( 'label-access', { place: 'apartment 201' } ) ).toBe( 'Can you give me access to apartment 201?' );
		expect( lines.say( 'prompt-locked', { place: 'apartment 201' } ) ).toBe( 'Locked: apartment 201 needs an access card' );
		expect( lines.say( 'notice-card', { label: 'Kessler Block 201 key card' } ) ).toBe( 'Added to your inventory: Kessler Block 201 key card.' );
		expect( () => accessLines( '## label-access\n\n- x' ) ).toThrow( /E_COMPANION_LINES|lack/ );

	} );

} );
