import { describe, expect, it } from 'vitest';
import { Acquaintances, codexEntries, contactCards, inventoryCards, itemModel, timeLabel } from './ScreenRecords.js';

const QUESTS = [
	{ id: 'q_main', title: 'The Weir Line', kind: 'main', steps: [ { text: 'Talk to Mira', npcName: 'Mira Chen', place: { kind: 'parcel', id: 'p5', name: 'clinic' } } ] },
	{ id: 'q_side', title: 'Last Call', kind: 'side', steps: [] }
];
const DRIVE = {
	materials: [ { slot: 'surface', key: 'cyberpunk/metal/mid', variantId: 'paint' }, { slot: 'accent', key: 'cyberpunk/metal/mid', variantId: 'zinc' } ],
	geometry: { primitives: [
		{ primitiveId: 'shell', kind: 'box', position: { x: 0, y: 0.01, z: 0 }, rotationRadians: { x: 0, y: 0, z: 0 }, size: { width: 0.09, height: 0.025, depth: 0.075 }, materialSlot: 'surface' },
		{ primitiveId: 'plug', kind: 'box', position: { x: 0.05, y: 0.01, z: 0 }, rotationRadians: { x: 0, y: 0.5, z: 0 }, size: { width: 0.03, height: 0.015, depth: 0.05 }, materialSlot: 'accent' }
	] }
};

describe( 'ScreenRecords', () => {

	it( 'builds an item\'s still model from its mission asset\'s boxes, coloured by variant, else by family', () => {

		expect( itemModel( null ) ).toBeNull();
		expect( itemModel( DRIVE ) ).toEqual( { parts: [
			{ size: [ 0.09, 0.025, 0.075 ], position: [ 0, 0.01, 0 ], rotation: [ 0, 0, 0 ], color: '#56656b' },
			{ size: [ 0.03, 0.015, 0.05 ], position: [ 0.05, 0.01, 0 ], rotation: [ 0, 0.5, 0 ], color: '#b7c1c3' }
		] } );

	} );

	it( 'gives each carried item its quantity, its stories main or side and its quest model', () => {

		const items = [
			{ id: 'i_drive', name: 'Sable\'s drive', quantity: 1, state: { kind: 'device', description: 'A data drive.', questlineIds: [ 'q_main', 'q_gone' ] } },
			{ id: 'coin', name: 'Coin', quantity: 3, state: { kind: 'money' } }
		];
		const cards = inventoryCards( items, QUESTS, ( questId, itemId ) => questId === 'q_main' && itemId === 'i_drive' ? DRIVE : null );
		expect( cards[ 0 ] ).toMatchObject( { id: 'i_drive', kind: 'device', description: 'A data drive.', quantity: 1, quests: [ { id: 'q_main', title: 'The Weir Line', kind: 'main' } ] } );
		expect( cards[ 0 ].model.parts ).toHaveLength( 2 );
		expect( cards[ 1 ] ).toEqual( { id: 'coin', name: 'Coin', kind: 'money', description: '', place: '', quantity: 3, quests: [] } );

	} );

	it( 'tells bought goods where they were bought and what they cost, and somebody\'s thing whose it was and how it came', () => {

		const [ whisky, photo, watch ] = inventoryCards( [
			{ id: 'goods-whisky', name: 'Glass of whisky', quantity: 2, state: { kind: 'goods', data: { goodId: 'whisky', price: 18, at: 'Wren\'s' } } },
			{ id: 'effect-a1-effect', name: 'Photo of Mia', quantity: 1, state: { kind: 'effect', data: { sort: 'photo', from: { npcId: 'a1', name: 'Ada Vance' }, how: 'given', worth: 1 } } },
			{ id: 'effect-a2-effect', name: 'Pocket watch', quantity: 1, state: { kind: 'effect', data: { sort: 'goods', from: { npcId: 'a2', name: 'Lane Ito' }, how: 'stolen', worth: 15 } } }
		], QUESTS );
		expect( whisky ).toMatchObject( { kind: 'drink', quantity: 2, description: 'Glass of whisky, bought at Wren\'s.', facts: [ { label: 'Bought at', value: 'Wren\'s' }, { label: 'Paid', value: '18 cr' } ] } );
		expect( photo ).toMatchObject( { kind: 'photo', description: 'Photo of Mia. It was Ada Vance\'s.', facts: [ { label: 'From', value: 'Ada Vance' }, { label: 'How', value: 'Given' } ] } );
		expect( watch.facts ).toEqual( [ { label: 'From', value: 'Lane Ito' }, { label: 'How', value: 'Lifted' } ] );

	} );

	it( 'looks a saved quest item\'s model up by the story\'s own id', () => {

		const asked = [];
		const cards = inventoryCards( [
			{ id: 'access_card_clerk', name: 'Clerk card', quantity: 1, state: { kind: 'key', itemId: 'ACCESS_CARD_CLERK', questlineIds: [ 'q_main' ] } }
		], QUESTS, ( questId, itemId ) => {

			asked.push( itemId );
			return itemId === 'ACCESS_CARD_CLERK' ? DRIVE : null;

		} );
		expect( asked ).toEqual( [ 'ACCESS_CARD_CLERK' ] );
		expect( cards[ 0 ] ).toMatchObject( { id: 'access_card_clerk', kind: 'key' } );
		expect( cards[ 0 ].model.parts ).toHaveLength( 2 );

	} );

	it( 'keeps the people talked to, from this game and from a saved memory, with how often and what they said last', () => {

		const people = new Acquaintances();
		people.remember( 'a1', [
			{ atMin: 540, speaker: 'npc', text: 'Morning.' }, { atMin: 541, speaker: 'player', text: 'Hi' }, { atMin: 541, speaker: 'npc', text: 'Fifty-seven.' }
		], { name: 'Tess Hale', role: 'retiree' } );
		people.remember( 'nobody', [ { atMin: 1, speaker: 'npc', text: 'x' } ], { name: '' } );
		people.met( 'a2', { name: 'Mira Chen', role: 'doctor', place: 'clinic', timeMin: 600 } );
		people.met( 'a2', { name: 'Mira Chen', role: 'doctor', place: 'clinic', timeMin: 640 } );
		expect( people.size ).toBe( 2 );
		expect( [ ...people ] ).toEqual( [
			{ npcId: 'a1', name: 'Tess Hale', role: 'retiree', firstPlace: '', lastPlace: '', talks: 1, lastMin: 541, line: 'Fifty-seven.' },
			{ npcId: 'a2', name: 'Mira Chen', role: 'doctor', firstPlace: 'clinic', lastPlace: 'clinic', talks: 2, lastMin: 640, line: '' }
		] );

	} );

	it( 'lists the contacts with what they are doing, whether they would pick up, the last thing they said and their portrait', () => {

		const people = new Acquaintances();
		people.met( 'a1', { name: 'Ada Vance', role: 'Clerk', place: 'Salt Wharf', timeMin: 725 } );
		people.heard( 'a1', 'Call me if you find the ledger.', 726 );
		people.heard( 'nobody', 'Who?' );
		people.met( 'k2', { name: 'Kip Marr', role: 'Dock hand', place: 'Pier', timeMin: 800 } );
		expect( people.get( 'a1' ) ).toMatchObject( { line: 'Call me if you find the ledger.', lastMin: 726 } );
		expect( people.get( 'nobody' ) ).toBeNull();
		expect( timeLabel( 1440 + 13 * 60 + 5 ) ).toBe( 'Tue 13:05' );

		const cards = contactCards( {
			contacts: [ { npcId: 'a1', addedMin: 726 }, { npcId: 'gone', addedMin: 700 }, { npcId: 'k2', addedMin: 801 } ],
			people,
			activityOf: ( npcId ) => npcId === 'k2' ? 'working' : null,
			answerOf: ( npcId ) => npcId === 'k2' ? 'busy' : 'answered',
			image: ( npcId ) => `face:${npcId}`
		} );
		expect( cards ).toEqual( [
			{ id: 'a1', name: 'Ada Vance', role: 'Clerk', status: 'online', added: 'Mon 12:06', met: 'Salt Wharf', line: 'Call me if you find the ledger.', lastTalk: 'Mon 12:06', image: 'face:a1' },
			{ id: 'k2', name: 'Kip Marr', role: 'Dock hand', status: 'busy', activity: 'working', added: 'Mon 13:21', met: 'Pier', lastTalk: 'Mon 13:20', image: 'face:k2' }
		] );

	} );

	it( 'files items, people and places under their categories with the quests they belong to', () => {

		const people = new Acquaintances();
		people.met( 'a2', { name: 'Mira Chen', role: 'doctor', place: 'clinic', timeMin: 600 } );
		const entries = codexEntries( {
			cards: inventoryCards( [ { id: 'i_drive', name: 'Sable\'s drive', quantity: 1, state: { kind: 'device', questlineIds: [ 'q_main' ] } } ], QUESTS ),
			people,
			places: [
				{ id: 'p5', name: 'clinic', use: 'hospital', district: 'downtown' }, { id: 'd0', name: 'downtown · rich' },
				{ id: 'p7', name: 'MARKET', use: 'commerce', district: 'downtown' }, { id: 'p9', name: 'MARKET', use: 'commerce', district: 'downtown' }
			],
			quests: QUESTS,
			castOf: ( npcId ) => npcId === 'a2' ? [ 'q_main' ] : [],
			personaOf: ( npcId ) => npcId === 'a2' ? 'Tired, kind and exact. Hides the list.' : null,
			pictures: { person: ( npcId ) => `face:${npcId}`, place: ( parcelId ) => `building:${parcelId}` }
		} );
		expect( entries.map( ( entry ) => entry.image ?? null ) ).toEqual( [ null, 'face:a2', 'building:p5', null, 'building:p7', 'building:p9' ] );
		expect( entries.map( ( entry ) => [ entry.id, entry.category, entry.title ] ) ).toEqual( [
			[ 'item:i_drive', 'items', 'Sable\'s drive' ],
			[ 'person:a2', 'people', 'Mira Chen' ],
			[ 'place:p5', 'places', 'Clinic' ],
			[ 'place:d0', 'places', 'Downtown · rich' ],
			[ 'place:p7', 'places', 'Market · p7' ],
			[ 'place:p9', 'places', 'Market · p9' ]
		] );
		expect( entries[ 0 ].related ).toEqual( [ { quest: 'q_main', title: 'The Weir Line', kind: 'main' } ] );
		expect( entries[ 1 ] ).toMatchObject( { subtitle: 'doctor', text: 'Tired, kind and exact.\n\nMira Chen has a part in The Weir Line.', related: [ { quest: 'q_main', kind: 'main' } ] } );
		expect( entries[ 2 ] ).toMatchObject( { text: 'A hospital lot in downtown.', related: [ { quest: 'q_main' } ] } );
		expect( entries[ 3 ] ).toMatchObject( { text: 'A district of the city.', model: { shape: 'map' }, related: [] } );

	} );

} );
