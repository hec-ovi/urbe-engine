import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import schema from './schema/economy.schema.json' with { type: 'json' };
import { Economy } from './Economy.js';
import { Holdings } from './Holdings.js';
import { carryOf, draw, meansOf } from './Carry.js';
import { goodOfItem, menuOf, priceOf } from './Prices.js';
import { PAYDAY_MIN, WEEK_MIN, Wallet, paydaysBy } from './Wallet.js';
import { PlayerItems } from '../access/PlayerItems.js';
import { economyLines, KEYS } from './EconomyLines.js';

const person = ( npcId, extra = {} ) => ( {
	npcId, name: { given: 'Ada', family: 'Vance' }, age: 34, type: 'clerk', traits: [], family: [],
	home: { parcelId: 'p1', unit: 0 }, job: { parcelId: 'p9', role: 'clerk', shift: { startMin: 480, endMin: 960, days: [ 0 ], kind: 'day' } },
	...extra
} );
const describe_ = ( scope ) => ( { label: `${scope} card` } );

/** The first id of `prefix<n>` whose draw for `slot` passes `test`. */
function idWhere( prefix, slot, test ) {

	for ( let n = 0; n < 5000; n ++ ) if ( test( draw( `${prefix}${n}`, slot ) ) ) return `${prefix}${n}`;
	throw new Error( 'no such id' );

}

describe( 'what a person carries', () => {

	it( 'is the same for the same person every time and differs between people', () => {

		const ada = person( 'a1001' );
		expect( carryOf( ada, { tier: 'mid' } ) ).toEqual( carryOf( structuredClone( ada ), { tier: 'mid' } ) );
		const others = Array.from( { length: 12 }, ( _, n ) => carryOf( person( `a${2000 + n}` ), { tier: 'mid' } ).credits );
		expect( new Set( others ).size ).toBeGreaterThan( 4 );

	} );

	it( 'draws credits within its means, and a child\'s pocket money by age', () => {

		const ranges = { short: [ 2, 18 ], 'getting-by': [ 10, 45 ], comfortable: [ 30, 120 ], 'well-off': [ 80, 300 ] };
		const tiers = { short: 'poor', 'getting-by': 'mid', comfortable: 'rich', 'well-off': 'high_rich' };
		for ( const [ means, [ lo, hi ] ] of Object.entries( ranges ) ) {

			const seen = Array.from( { length: 60 }, ( _, n ) => carryOf( person( `m${means}${n}` ), { tier: tiers[ means ] } ) );
			expect( seen.every( ( carry ) => carry.means === means ) ).toBe( true );
			expect( seen.every( ( carry ) => carry.credits >= lo && carry.credits <= hi && Number.isInteger( carry.credits ) ) ).toBe( true );

		}
		const children = Array.from( { length: 40 }, ( _, n ) => carryOf( person( `c${n}`, { age: 9, job: undefined } ), { tier: 'high_rich' } ) );
		expect( children.every( ( carry ) => carry.credits >= 0 && carry.credits <= 6 ) ).toBe( true );
		const youths = Array.from( { length: 40 }, ( _, n ) => carryOf( person( `y${n}`, { age: 15, job: undefined } ), { tier: 'high_rich' } ) );
		expect( youths.every( ( carry ) => carry.credits >= 0 && carry.credits <= 15 ) ).toBe( true );
		expect( Math.max( ...youths.map( ( carry ) => carry.credits ) ) ).toBeGreaterThan( 6 );

	} );

	it( 'reads a household\'s means from its home tier, work, children and post', () => {

		expect( meansOf( person( 'a' ), { tier: 'mid' } ) ).toBe( 'getting-by' );
		expect( meansOf( person( 'a', { job: undefined } ), { tier: 'mid' } ) ).toBe( 'short' );
		expect( meansOf( person( 'a', { job: undefined, transitJob: { role: 'driver' } } ), { tier: 'mid' } ) ).toBe( 'getting-by' );
		expect( meansOf( person( 'a', { family: [ { relation: 'child', name: { given: 'Mia' } } ] } ), { tier: 'poor' } ) ).toBe( 'short' );
		expect( meansOf( person( 'a', { job: { parcelId: 'p9', role: 'executive' } } ), { tier: 'rich' } ) ).toBe( 'well-off' );
		expect( meansOf( person( 'a' ), { tier: 'high_rich' } ) ).toBe( 'well-off' );

	} );

	it( 'carries a card per scope, a phone, papers, the post\'s kit and one effect, in that order', () => {

		const scopes = [ 'home:p1/floor:2/u1', 'staff:p9' ];
		const carry = carryOf( person( 'a1001' ), { tier: 'mid', scopes, describe: describe_ } );
		expect( carry.things.slice( 0, 5 ).map( ( thing ) => thing.slot ) ).toEqual( [ 'card:home:p1/floor:2/u1', 'card:staff:p9', 'phone', 'papers', 'kit' ] );
		expect( carry.things[ 0 ] ).toMatchObject( { kind: 'access-card', name: 'home:p1/floor:2/u1 card', worth: 0, giftable: true } );
		expect( carry.things.find( ( thing ) => thing.slot === 'phone' ) ).toMatchObject( { name: 'a phone', worth: 30, giftable: false } );
		expect( carry.things.find( ( thing ) => thing.slot === 'papers' ) ).toMatchObject( { giftable: false, worth: 0 } );
		expect( carry.things.find( ( thing ) => thing.slot === 'kit' ) ).toMatchObject( { name: 'a rubber stamp in a tin', worth: 4 } );
		expect( carry.things.filter( ( thing ) => thing.slot === 'effect' ) ).toHaveLength( 1 );
		expect( carry.things.length ).toBeLessThanOrEqual( 7 );
		const guard = carryOf( person( 'g1', { job: { parcelId: 'p9', role: 'security' } } ), { jobType: 'police' } );
		expect( guard.things.find( ( thing ) => thing.slot === 'kit' ).name ).toBe( 'a warrant notebook' );
		expect( carryOf( person( 'g1', { job: { parcelId: 'p9', role: 'security' } } ), { jobType: 'mall' } ).things.find( ( thing ) => thing.slot === 'kit' ).name ).toBe( 'a torch' );
		const child = carryOf( person( 'k1', { age: 8, job: undefined } ) );
		expect( child.things.some( ( thing ) => thing.slot === 'phone' || thing.slot === 'papers' ) ).toBe( false );
		const crowded = carryOf( person( 'a1001' ), { scopes: [ 'home:p1/f/u1', 'staff:p9', 'service:p9', 'security:p9', 'homes:p9' ], describe: describe_ } );
		expect( crowded.things ).toHaveLength( 7 );

	} );

	it( 'carries a photo only of a child, a note of a partner, and a letter only for an adult who grew up away', () => {

		const parent = carryOf( person( 'f1', { family: [ { relation: 'partner', name: { given: 'Rolf' } }, { relation: 'child', name: { given: 'Mia' } } ] } ) );
		expect( parent.things.find( ( thing ) => thing.slot === 'effect' ) ).toMatchObject( { name: 'a photo of Mia', sort: 'photo' } );
		const partnered = carryOf( person( 'f2', { family: [ { relation: 'partner', name: { given: 'Rolf' } } ] } ) );
		expect( partnered.things.find( ( thing ) => thing.slot === 'effect' ).name ).toBe( 'a note from Rolf' );
		const away = idWhere( 'r', 'roots', ( value ) => value >= 0.7 );
		const home = idWhere( 'r', 'roots', ( value ) => value < 0.7 );
		expect( carryOf( person( away ) ).things.find( ( thing ) => thing.slot === 'effect' ) ).toMatchObject( { name: 'a letter from where you grew up', label: 'a letter from where Ada grew up' } );
		expect( carryOf( person( away, { age: 16, job: undefined } ) ).things.find( ( thing ) => thing.slot === 'effect' ).name ).not.toMatch( /letter/ );
		expect( carryOf( person( home ) ).things.find( ( thing ) => thing.slot === 'effect' ).name ).not.toMatch( /letter|photo|note/ );
		for ( let n = 0; n < 60; n ++ ) {

			const effect = carryOf( person( `e${n}`, { age: 15, job: undefined } ), { tier: 'poor' } ).things.find( ( thing ) => thing.slot === 'effect' );
			expect( effect.name ).not.toMatch( /cigarettes|letter/ );
			expect( effect.worth ).toBeGreaterThanOrEqual( 1 );
			expect( effect.worth ).toBeLessThanOrEqual( 15 );

		}

	} );

	it( 'draws the life history\'s own number for roots', () => {

		// Quests LifeHistory.draw: FNV-1a of `npcId|slot`, over 2^32.
		let hash = 2166136261;
		for ( const char of 'a59987|roots' ) hash = Math.imul( hash ^ char.charCodeAt( 0 ), 16777619 );
		expect( draw( 'a59987', 'roots' ) ).toBe( ( hash >>> 0 ) / 4294967296 );

	} );

} );

describe( 'prices', () => {

	it( 'scales a good by the tier of the place, but never a fixed one', () => {

		expect( priceOf( 'whisky', 'rich' ) ).toBe( 18 );
		expect( priceOf( 'whisky', 'poor' ) ).toBe( 8 );
		expect( priceOf( 'whisky', 'mid' ) ).toBe( 12 );
		expect( priceOf( 'whisky', 'high_rich' ) ).toBe( 26 );
		expect( priceOf( 'hot-meal', 'rich' ) ).toBe( 14 );
		for ( const tier of [ 'poor', 'mid', 'rich', 'high_rich' ] ) expect( priceOf( 'ration-drink', tier ) ).toBe( 2 );
		expect( priceOf( 'nothing', 'mid' ) ).toBeNull();
		expect( menuOf( 'restaurant', 'rich' ).map( ( good ) => good.goodId ) ).toEqual( [ 'ration-drink', 'sandwich', 'hot-meal', 'beer', 'whisky' ] );
		expect( menuOf( 'park', 'mid' ).map( ( good ) => good.goodId ) ).toEqual( [ 'ration-drink', 'coffee', 'cigarettes', 'bulletin' ] );
		expect( menuOf( 'police' ) ).toEqual( [] );

	} );

	it( 'knows the good a story\'s item is by its name', () => {

		expect( goodOfItem( 'amber whisky' ) ).toBe( 'whisky' );
		expect( goodOfItem( 'ration drink' ) ).toBe( 'ration-drink' );
		expect( goodOfItem( 'Glass of whisky' ) ).toBe( 'whisky' );
		expect( goodOfItem( 'a cold beer' ) ).toBe( 'beer' );
		expect( goodOfItem( 'steak' ) ).toBeNull();
		expect( goodOfItem( '' ) ).toBeNull();

	} );

} );

describe( 'the wallet', () => {

	it( 'pays on Friday at 17:00, not a minute before, less the file fee', () => {

		const wallet = new Wallet( { credits: 40, paidWeek: 0 } );
		expect( wallet.payday( PAYDAY_MIN - 1 ) ).toBeNull();
		expect( wallet.credits ).toBe( 40 );
		expect( wallet.payday( PAYDAY_MIN ) ).toEqual( { weeks: 1, gross: 60, fee: 4, net: 56 } );
		expect( wallet.credits ).toBe( 96 );
		expect( wallet.payday( PAYDAY_MIN + 60 ) ).toBeNull();
		expect( wallet.log.at( - 1 ) ).toEqual( { atMin: PAYDAY_MIN, what: 'wage', amount: 56 } );

	} );

	it( 'catches up two missed weeks at most, and a save made before credits owes nothing for the past', () => {

		const wallet = new Wallet( { credits: 0, paidWeek: 0 } );
		expect( wallet.payday( PAYDAY_MIN + 4 * WEEK_MIN ) ).toEqual( { weeks: 2, gross: 120, fee: 8, net: 112 } );
		expect( wallet.paidWeek ).toBe( 5 );
		expect( paydaysBy( 0 ) ).toBe( 0 );
		expect( paydaysBy( PAYDAY_MIN ) ).toBe( 1 );
		const old = Wallet.restore( undefined, PAYDAY_MIN + 3 * WEEK_MIN + 10 );
		expect( old.credits ).toBe( 40 );
		expect( old.payday( PAYDAY_MIN + 3 * WEEK_MIN + 20 ) ).toBeNull();
		expect( Wallet.restore( undefined, 486 ).credits ).toBe( 40 );

	} );

	it( 'spends only what it holds and keeps the last forty entries', () => {

		const wallet = new Wallet( { credits: 10 } );
		expect( wallet.spend( 11, { what: 'paid' } ) ).toBe( false );
		expect( wallet.credits ).toBe( 10 );
		expect( wallet.spend( 3, { what: 'fare', atMin: 5 } ) ).toBe( true );
		expect( wallet.log.at( - 1 ) ).toEqual( { atMin: 5, what: 'fare', amount: - 3 } );
		for ( let n = 0; n < 50; n ++ ) wallet.add( 1, { what: 'received', atMin: n } );
		expect( wallet.log ).toHaveLength( 40 );
		expect( wallet.can( 1.5 ) ).toBe( false );

	} );

} );

describe( 'holdings', () => {

	const base = ( npcId ) => npcId.startsWith( 'x' ) ? null : carryOf( person( npcId ), { scopes: [ 'home:p1/f/u1' ], describe: describe_ } );

	it( 'keeps nobody until something changes, then a whole snapshot of that person, and takes it back from the save', () => {

		const holdings = new Holdings( { base } );
		const before = holdings.of( 'a1001' );
		expect( holdings.serialize() ).toEqual( [] );
		expect( holdings.of( 'x1' ) ).toBeNull();
		expect( holdings.debit( 'a1001', 3 ) ).toBe( Math.min( 3, before.credits ) );
		const phone = holdings.remove( 'a1001', 'phone' );
		expect( phone.slot ).toBe( 'phone' );
		expect( holdings.remove( 'a1001', 'phone' ) ).toBeNull();
		holdings.add( 'a1001', { id: 'goods-beer', name: 'Beer', kind: 'goods', atMin: 700 } );
		holdings.deal( 'a1001', { what: 'got-thing', name: 'Beer', atMin: 700 } );
		holdings.ask( 'a1001', 5 );
		const now = holdings.of( 'a1001' );
		expect( now.things.some( ( thing ) => thing.slot === 'phone' ) ).toBe( false );
		expect( now.things.at( - 1 ) ).toMatchObject( { slot: 'got:goods-beer', name: 'Beer', from: 'stranger', giftable: true, atMin: 700 } );
		expect( holdings.serialize() ).toEqual( [ {
			npcId: 'a1001', credits: before.credits - Math.min( 3, before.credits ), gone: [ 'phone' ],
			got: [ { id: 'goods-beer', name: 'Beer', kind: 'goods', atMin: 700 } ], dealt: [ { what: 'got-thing', name: 'Beer', atMin: 700 } ]
		} ] );
		const back = new Holdings( { base } ).restore( JSON.parse( JSON.stringify( holdings.serialize() ) ) );
		expect( back.of( 'a1001' ) ).toEqual( now );
		// An ask is for this session only.
		expect( back.asked( 'a1001' ) ).toBeNull();
		expect( holdings.asked( 'a1001' ) ).toBe( 5 );

	} );

	it( 'keeps a story\'s item and a card a person took', () => {

		const holdings = new Holdings( { base } );
		holdings.add( 'a1001', { id: 'drink_whisky_kessel', name: 'amber whisky', kind: 'story' } );
		expect( holdings.of( 'a1001' ).things.at( - 1 ).giftable ).toBe( false );

	} );

} );

describe( 'the economy in the save', () => {

	const base = ( npcId ) => carryOf( person( npcId ), { scopes: [ 'home:p1/f/u1' ], describe: describe_ } );

	it( 'serializes what its schema takes, strictly, and restores it', () => {

		const items = new PlayerItems();
		const economy = Economy.restore( undefined, { timeMin: 486, completedSettled: [ 'shift:main/s_sort' ], base, items, now: () => 700, nameOf: () => 'Ada Vance' } );
		expect( economy.wallet.credits ).toBe( 40 );
		expect( economy.settle( 'shift:main/s_sort' ) ).toBe( false );
		expect( economy.settle( 'reward:sq_one' ) ).toBe( true );
		economy.trades.pay( 'a1001', 5, 'for the help' );
		economy.trades.receive( 'a1001', 2 );
		economy.holdings.deal( 'a1001', { what: 'bribe-refused', atMin: 701 } );
		economy.wallet.note( { atMin: 701, what: 'bribe', npcId: 'a1001', name: 'Ada Vance' } );
		const saved = economy.serialize();
		const validate = new Ajv2020( { strict: true, allErrors: true } ).compile( schema );
		expect( validate( saved ), JSON.stringify( validate.errors ) ).toBe( true );
		expect( saved ).toMatchObject( { credits: 37, paidWeek: 0, settled: [ 'shift:main/s_sort', 'reward:sq_one' ] } );
		expect( validate( { credits: 1 } ) ).toBe( false );
		expect( validate( { ...saved, extra: true } ) ).toBe( false );
		const back = Economy.restore( JSON.parse( JSON.stringify( saved ) ), { timeMin: 9000, completedSettled: [], base, items } );
		expect( back.serialize() ).toEqual( saved );
		// A saved economy pays what its own record has not settled; nothing the save did not know is marked paid.
		expect( back.settle( 'reward:sq_two' ) ).toBe( true );

	} );

	it( 'reads every key it needs from its lines and refuses an unknown field', () => {

		const lines = economyLines();
		expect( lines.say( 'notice-paid', { amount: 18, name: 'Tomas Wren' } ) ).toBe( '−18 cr paid to Tomas Wren' );
		expect( lines.say( 'notice-wage', { net: 56 } ) ).toBe( '+56 cr pay booked' );
		expect( lines.say( 'prompt-buy', { name: 'amber whisky', price: 18 } ) ).toBe( 'E  buy amber whisky · 18 cr' );
		expect( KEYS.length ).toBeGreaterThan( 30 );
		expect( () => economyLines( '## notice-paid\n\n- {nobody}\n' ) ).toThrow();

	} );

} );
