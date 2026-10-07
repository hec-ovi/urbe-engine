import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { GARMENTS, HomeDressing, isPersonal } from './HomeDressing.js';
import { placedModules } from './InteriorModules.js';

const person = ( npcId, family, apartment, { type = 'quest_vendor', age = 30, relatives = [] } = {} ) => ( {
	npcId, name: { given: npcId.toUpperCase(), family }, age, type, flags: {},
	home: { parcelId: 'p9', unit: 0, ...( apartment ? { apartment: { id: apartment, floor: 7 } } : {} ) },
	family: relatives
} );

const floor = ( placements ) => ( {
	id: 'p9:7', parcelId: 'p9', floor: 7, elevation: 33.5,
	rooms: [ { id: 'f1-home-2', unit: 'f1-home-2' }, { id: 'f1-bath-2', unit: 'f1-home-2' }, { id: 'f1-hall' } ],
	apartmentEntrances: [ { unit: 'f1-home-2', number: '702' } ],
	placements
} );

const at = ( module, room = 'f1-home-2' ) => ( { module, room, position: [ 1, 1.4, 2 ], rotationY: 0, scale: [ 1, 1, 1 ] } );
const matrixOf = ( { position }, elevation ) => new THREE.Matrix4().makeTranslation( position[ 0 ], position[ 1 ] + elevation, position[ 2 ] );

describe( 'HomeDressing', () => {

	it( 'knows a dwelling by the people the simulation houses in it, the eldest first, and none of a neighbour', () => {

		const people = [ person( 'a2', 'Kim', 'floor:7/f1-home-2', { age: 24 } ), person( 'a1', 'Kim', 'floor:7/f1-home-2', { age: 51 } ),
			person( 'a3', 'Voss', 'floor:7/f1-home-3' ), person( 'a4', 'Kim', null ) ];
		const homes = new HomeDressing( { sim: { findNPCs: ( { parcelId } ) => parcelId === 'p9' ? people : [] } } );

		expect( homes.residentsOf( 'p9', 'floor:7/f1-home-2' ).map( ( npc ) => npc.npcId ) ).toEqual( [ 'a1', 'a2' ] );
		expect( homes.residentsOf( 'p9', 'floor:7/f1-home-9' ) ).toEqual( [] );

	} );

	it( 'shows the household: its family name and number, a relative it knows in the photo, the coat of the trade', () => {

		const elle = person( 'a63918', 'Kim', 'floor:7/f1-home-2', { relatives: [ { npcId: 'a5', relation: 'sibling', instantiated: false }, { npcId: 'a6', relation: 'sibling', instantiated: true } ] } );
		const homes = new HomeDressing( { sim: { findNPCs: () => [ elle ], getNPC: () => { throw new Error( 'E_UNKNOWN_ID' ); } }, categoryOf: ( type ) => type === 'quest_vendor' ? 'vendor' : null } );
		const home = homes.householdOf( 'p9', floor( [] ), 'f1-home-2' );

		expect( home ).toMatchObject( { homeId: 'floor:7/f1-home-2', number: '702', name: 'KIM', initials: 'A. Kim', pictured: 'a6', garment: GARMENTS.vendor } );
		const empty = new HomeDressing( { sim: { findNPCs: () => [] } } ).householdOf( 'p9', floor( [] ), 'f1-home-2' );
		expect( empty ).toMatchObject( { number: '702', name: null, pictured: null, garment: null } );
		// a sister the simulation names but nobody met is established for the photo
		const lone = person( 'a63918', 'Kim', 'floor:7/f1-home-2', { relatives: [ { npcId: 'a7', relation: 'parent', instantiated: false }, { npcId: 'a8', relation: 'sibling', instantiated: false } ] } );
		const asked = [];
		const sim = { findNPCs: () => [ lone ], getNPC: () => { throw new Error( 'E_UNKNOWN_ID' ); }, relative: ( id ) => asked.push( id ) };
		expect( new HomeDressing( { sim } ).householdOf( 'p9', floor( [] ), 'f1-home-2' ).pictured ).toBe( 'a8' );
		expect( asked ).toEqual( [ 'a8' ] );

	} );

	it( 'hangs the resident\'s coat on the hook as a module copy and leaves a stranger\'s hook bare', () => {

		const elle = person( 'a63918', 'Kim', 'floor:7/f1-home-2', { type: 'quest_clinic' } );
		const homes = new HomeDressing( { sim: { findNPCs: () => [ elle ] }, categoryOf: () => 'clinical' } );
		const record = floor( [ at( 'personal-c8-hook' ), at( 'personal-c8-hook', 'f1-hall' ), at( 'wall-art-c8-tags-1' ) ] );
		const { copies, group } = homes.dress( 'p9', record, { matrixOf, fillOf: () => null } );

		expect( copies.map( ( copy ) => copy.id ) ).toEqual( [ GARMENTS.clinical ] );
		expect( copies[ 0 ].matrix.elements[ 13 ] ).toBeCloseTo( 34.9 );
		expect( group.children ).toEqual( [] );

	} );

	it( 'loads every trade\'s coat wherever a home publishes a hook, and treats only the holders as personal', () => {

		const building = { interior: { building: { floors: [ { index: 0, layout: 'middle', elevation: 0 } ] },
			layouts: { middle: { floor: { height: 3, rooms: [], lights: [] }, placements: [ { module: 'personal-c8-hook' } ] } } } };

		expect( [ ...placedModules( new Map( [ [ 'p9', building ] ] ) ) ].sort() ).toEqual( [ 'personal-c8-hook', ...Object.values( GARMENTS ) ].sort() );
		expect( isPersonal( 'personal-c8-photo' ) ).toBe( true );
		expect( isPersonal( GARMENTS.worker ) ).toBe( false );
		expect( isPersonal( 'wall-art-c8-tags-1' ) ).toBe( false );

	} );

} );
