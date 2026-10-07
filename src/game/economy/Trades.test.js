import { describe, expect, it, vi } from 'vitest';
import { Trades, goodsItem } from './Trades.js';
import { Holdings } from './Holdings.js';
import { Wallet } from './Wallet.js';
import { carryOf, draw } from './Carry.js';
import { menuOf } from './Prices.js';
import { TalkTerms } from './TalkTerms.js';
import { PlayerItems } from '../access/PlayerItems.js';

const person = ( npcId, extra = {} ) => ( {
	npcId, name: { given: 'Ada', family: 'Vance' }, age: 34, family: [ { relation: 'child', name: { given: 'Mia' } } ],
	home: { parcelId: 'p1', unit: 0 }, job: { parcelId: 'p9', role: 'clerk' }, ...extra
} );

function setup( { credits = 40, base = null, quests = null } = {} ) {

	const wallet = new Wallet( { credits } );
	const holdings = new Holdings( { base: base ?? ( ( npcId ) => carryOf( person( npcId ), { scopes: [ 'home:p1/f/u1' ], describe: () => ( { label: 'Kessler Block key card' } ) } ) ) } );
	const items = new PlayerItems();
	const card = vi.fn( ( scope, { npcId, name, how, atMin } ) => ( {
		id: `card-${scope.replace( /[^a-z0-9]+/g, '-' )}`, kind: 'access-card', label: 'Kessler Block key card',
		data: { grants: [ scope ], issuer: { npcId, name }, how, atMin }
	} ) );
	const trades = new Trades( { wallet, holdings, items, quests, now: () => 700, nameOf: () => 'Ada Vance', card } );
	return { wallet, holdings, items, trades, card };

}

describe( 'transfers between the player and a person', () => {

	it( 'hands one of the player\'s own things over: it leaves them and joins what the person got', () => {

		const { items, holdings, trades } = setup();
		items.stack( { id: 'goods-beer', kind: 'goods', label: 'Beer', data: { goodId: 'beer', price: 4 } }, 2 );
		const result = trades.hand( 'a1', 'own:goods-beer' );
		expect( result ).toMatchObject( { ok: true, kind: 'given', name: 'Beer', to: 'Ada Vance' } );
		expect( items.get( 'goods-beer' ).quantity ).toBe( 1 );
		expect( holdings.of( 'a1' ).got ).toEqual( [ { id: 'goods-beer', name: 'Beer', kind: 'goods', atMin: 700 } ] );
		expect( holdings.of( 'a1' ).dealt ).toEqual( [ { what: 'got-thing', name: 'Beer', atMin: 700 } ] );
		expect( trades.hand( 'a1', 'own:goods-beer' ).ok ).toBe( true );
		expect( items.has( 'goods-beer' ) ).toBe( false );
		expect( trades.hand( 'a1', 'own:goods-beer' ) ).toMatchObject( { ok: false, reason: 'missing' } );

	} );

	it( 'hands a story\'s item through its story: delivered, theirs to keep, or refused', () => {

		const quests = {
			hand: vi.fn( ( itemId, npcId, place, timeMin ) => {

				if ( itemId === 'DRINK_RATION_STAMP' ) return { questId: 'main', how: 'deliver', name: 'ration drink', moved: [ { completed: [ { stepId: 's_press' } ] } ] };
				if ( itemId === 'DRINK_WHISKY_KESSEL' ) return { questId: 'sq_floor29_card', how: 'theirs', name: 'amber whisky', moved: [] };
				const error = new Error( 'not now' );
				error.code = 'E_UNAVAILABLE';
				throw error;

			} )
		};
		const { holdings, trades } = setup( { quests } );
		const delivered = trades.hand( 'a1', 'quest:DRINK_RATION_STAMP', { parcelId: 'p2136' } );
		expect( quests.hand ).toHaveBeenCalledWith( 'DRINK_RATION_STAMP', 'a1', { parcelId: 'p2136' }, 700 );
		expect( delivered ).toMatchObject( { ok: true, kind: 'given', how: 'deliver', questId: 'main', name: 'ration drink' } );
		expect( delivered.moved ).toHaveLength( 1 );
		expect( trades.hand( 'a2', 'quest:DRINK_WHISKY_KESSEL' ) ).toMatchObject( { ok: true, how: 'theirs', moved: [] } );
		expect( holdings.of( 'a2' ).got ).toEqual( [ { id: 'drink_whisky_kessel', name: 'amber whisky', kind: 'story', atMin: 700 } ] );
		expect( trades.hand( 'a3', 'quest:ACCESS_CARD_CLERK' ) ).toMatchObject( { ok: false, reason: 'refused' } );
		expect( holdings.of( 'a3' ).got ).toEqual( [] );

	} );

	it( 'pays only what the wallet holds, and a person pays no more than they carry', () => {

		const { wallet, holdings, trades } = setup( { credits: 4 } );
		expect( trades.pay( 'a1', 5, 'help' ) ).toMatchObject( { ok: false, reason: 'short' } );
		expect( wallet.credits ).toBe( 4 );
		expect( holdings.serialize() ).toEqual( [] );
		expect( trades.pay( 'a1', 4, 'help' ) ).toMatchObject( { ok: true, kind: 'paid', amount: 4 } );
		const carried = holdings.of( 'a1' ).credits;
		expect( trades.receive( 'a1', carried + 50 ) ).toMatchObject( { ok: true, kind: 'received', amount: carried } );
		expect( holdings.of( 'a1' ).credits ).toBe( 0 );
		expect( wallet.credits ).toBe( carried );
		expect( trades.receive( 'a1', 1 ) ).toMatchObject( { ok: false, reason: 'empty' } );
		expect( holdings.of( 'a1' ).dealt.map( ( entry ) => entry.what ) ).toEqual( [ 'got-credits', 'gave-credits' ] );

	} );

	it( 'takes a thing a person hands over as the player\'s effect, never a card or what is not theirs to give', () => {

		const { items, holdings, trades } = setup();
		const result = trades.receiveThing( 'a1', 'effect' );
		expect( result ).toMatchObject( { ok: true, kind: 'got', name: 'Photo of Mia' } );
		expect( items.get( result.itemId ) ).toMatchObject( { kind: 'effect', label: 'Photo of Mia', data: { sort: 'photo', from: { npcId: 'a1', name: 'Ada Vance' }, how: 'given', worth: 1 } } );
		expect( holdings.of( 'a1' ).gone ).toEqual( [ 'effect' ] );
		expect( trades.receiveThing( 'a1', 'effect' ).ok ).toBe( false );
		expect( trades.receiveThing( 'a1', 'phone' ).ok ).toBe( false );
		expect( trades.receiveThing( 'a1', 'card:home:p1/f/u1' ).ok ).toBe( false );

	} );

	it( 'buys off a counter\'s menu, a second one stacking, and not past the wallet', () => {

		const { wallet, items, trades } = setup( { credits: 30 } );
		const counter = { venueType: 'restaurant', tier: 'rich', parcelId: 'p1699', menu: menuOf( 'restaurant', 'rich' ), name: 'Wren\'s', payee: 'Tomas Wren', npcId: 'w1' };
		const first = trades.buy( counter, 'whisky' );
		expect( first ).toMatchObject( { ok: true, kind: 'bought', amount: 18, name: 'glass of whisky', payee: 'Tomas Wren' } );
		expect( wallet.credits ).toBe( 12 );
		expect( trades.buy( counter, 'whisky' ) ).toMatchObject( { ok: false, reason: 'short', amount: 18 } );
		expect( trades.buy( counter, 'beer' ) ).toMatchObject( { ok: true, amount: 6 } );
		expect( trades.buy( counter, 'beer' ) ).toMatchObject( { ok: true, amount: 6 } );
		expect( items.get( 'goods-beer' ) ).toMatchObject( { kind: 'goods', label: 'Beer', quantity: 2, data: { goodId: 'beer', price: 6, at: 'Wren\'s', parcelId: 'p1699' } } );
		expect( trades.buy( counter, 'tea' ) ).toMatchObject( { ok: false, reason: 'missing' } );
		expect( wallet.log.map( ( entry ) => entry.amount ) ).toEqual( [ - 18, - 6, - 6 ] );

	} );

	it( 'sells a thing to a till at half its worth, and to a person only what they can pay', () => {

		const { wallet, items, holdings, trades } = setup( { credits: 0 } );
		items.add( { id: 'effect-a9-flask', kind: 'effect', label: 'Hip flask of schnapps', data: { worth: 6, sort: 'flask' } } );
		const terms = new TalkTerms( { holdings, wallet, items } );
		const shop = { venueType: 'commerce', menu: menuOf( 'commerce', 'mid' ) };
		const [ offered ] = terms.tradeOffers( { npcId: 'a1', counter: shop } ).buy.items;
		expect( offered ).toEqual( { itemId: 'own:effect-a9-flask', name: 'Hip flask of schnapps', price: 3 } );
		expect( trades.sell( 'a1', offered.itemId, offered.price, true ) ).toMatchObject( { ok: true, kind: 'sold', amount: 3 } );
		expect( wallet.credits ).toBe( 3 );
		expect( holdings.serialize() ).toEqual( [] );
		items.add( { id: 'goods-whisky', kind: 'goods', label: 'Glass of whisky', data: { price: 18 } } );
		const poor = setup( { credits: 0, base: () => ( { credits: 5, means: 'short', things: [] } ) } );
		poor.items.add( { id: 'goods-whisky', kind: 'goods', label: 'Glass of whisky', data: { price: 18 } } );
		expect( poor.trades.sell( 'a1', 'own:goods-whisky', 18, false ) ).toMatchObject( { ok: false, reason: 'short' } );
		expect( new TalkTerms( poor ).tradeOffers( { npcId: 'a1' } ).buy.items ).toEqual( [ { itemId: 'own:goods-whisky', name: 'Glass of whisky', price: 5 } ] );
		expect( poor.trades.sell( 'a1', 'own:goods-whisky', 5, false ) ).toMatchObject( { ok: true, amount: 5 } );
		expect( poor.holdings.of( 'a1' ) ).toMatchObject( { credits: 0, got: [ { id: 'goods-whisky', kind: 'goods' } ] } );

	} );

	it( 'lifts by a fixed seed the same way each time, by weights renormalised over what the person has', () => {

		const lifted = ( seed, base, lacked = [ 'home:p1/f/u1' ] ) => setup( { base } ).trades.lift( 'a1', seed, lacked );
		const full = () => ( { credits: 50, means: 'getting-by', things: [ { slot: 'card:home:p1/f/u1', kind: 'access-card', name: 'card', worth: 0, giftable: true }, { slot: 'phone', kind: 'phone', name: 'a phone', worth: 30, giftable: false, sort: 'phone' } ] } );
		const seeds = Array.from( { length: 200 }, ( _, n ) => `a1|${n}` );
		const kinds = seeds.map( ( seed ) => {

			const result = lifted( seed, full );
			return result.amount ? 'credits' : result.card ? 'card' : 'thing';

		} );
		expect( kinds ).toEqual( seeds.map( ( seed ) => {

			const roll = draw( seed, 'what' );
			return roll < 0.5 ? 'credits' : roll < 0.75 ? 'card' : 'thing';

		} ) );
		expect( lifted( 'a1|3', full ) ).toEqual( lifted( 'a1|3', full ) );
		// With nothing in their pockets and no card the player lacks, it is all credits.
		const cash = () => ( { credits: 20, means: 'short', things: [] } );
		for ( const seed of seeds.slice( 0, 20 ) ) {

			const result = lifted( seed, cash, [] );
			expect( result ).toMatchObject( { ok: true, kind: 'lifted' } );
			expect( result.amount ).toBe( Math.max( 1, Math.ceil( 20 * ( 0.3 + 0.4 * draw( seed, 'fold' ) ) ) ) );

		}
		// Only a card and a pocket thing: half and half.
		const noCash = () => ( { ...full(), credits: 0 } );
		expect( seeds.map( ( seed ) => lifted( seed, noCash ).card ? 'card' : 'thing' ) ).toEqual( seeds.map( ( seed ) => draw( seed, 'what' ) < 0.5 ? 'card' : 'thing' ) );
		expect( lifted( 'a1|1', () => ( { credits: 0, means: 'short', things: [] } ), [] ) ).toMatchObject( { ok: false, reason: 'empty' } );

	} );

	it( 'takes a lifted card off the person and gives the player the stolen copy', () => {

		const { trades, holdings, items, card } = setup( { base: () => ( { credits: 0, means: 'short', things: [ { slot: 'card:home:p1/f/u1', kind: 'access-card', name: 'card', worth: 0, giftable: true } ] } ) } );
		const result = trades.lift( 'a1', 'a1|7', [ 'home:p1/f/u1' ] );
		expect( result ).toMatchObject( { ok: true, kind: 'lifted', name: 'Kessler Block key card' } );
		expect( card ).toHaveBeenCalledWith( 'home:p1/f/u1', { npcId: 'a1', name: 'Ada Vance', how: 'stolen', atMin: 700 } );
		expect( items.get( result.itemId ).data.how ).toBe( 'stolen' );
		expect( holdings.of( 'a1' ).gone ).toEqual( [ 'card:home:p1/f/u1' ] );
		expect( trades.lift( 'a1', 'a1|8', [ 'home:p1/f/u1' ] ) ).toMatchObject( { ok: false, reason: 'empty' } );

	} );

	it( 'keeps a bought good\'s place and price', () => {

		expect( goodsItem( { goodId: 'coffee', name: 'cup of coffee', price: 3 }, { name: 'Café Ost', parcelId: 'p3' }, 600 ) ).toEqual( {
			id: 'goods-coffee', kind: 'goods', label: 'Cup of coffee', data: { goodId: 'coffee', price: 3, at: 'Café Ost', parcelId: 'p3', atMin: 600 }
		} );

	} );

} );

describe( 'what a talk is told', () => {

	it( 'tells what a person carries but their cards, what they got from the player, the dealings and an unpaid ask', () => {

		const { holdings, wallet, items, trades } = setup();
		const terms = new TalkTerms( { holdings, wallet, items } );
		const before = terms.carryContext( 'a1' );
		expect( before.items.some( ( item ) => /key card/.test( item.name ) ) ).toBe( false );
		expect( before.items.map( ( item ) => item.name ) ).toContain( 'a photo of Mia' );
		expect( before ).not.toHaveProperty( 'dealings' );
		items.add( { id: 'goods-beer', kind: 'goods', label: 'Beer', data: { price: 4 } } );
		trades.hand( 'a1', 'own:goods-beer' );
		holdings.ask( 'a1', 10 );
		const after = terms.carryContext( 'a1' );
		expect( after.items.at( - 1 ) ).toEqual( { name: 'Beer', from: 'stranger', atMin: 700 } );
		expect( after.dealings ).toEqual( [ { what: 'got-thing', name: 'Beer', atMin: 700 } ] );
		expect( after.asked ).toBe( 10 );
		expect( terms.carryContext( 'nobody' ) ).not.toBeNull();

	} );

	it( 'offers what may change hands this turn', () => {

		const { holdings, wallet, items } = setup();
		const terms = new TalkTerms( { holdings, wallet, items } );
		items.add( { id: 'card-staff-p9', kind: 'access-card', label: 'Ostbank staff card', data: {} } );
		const offers = terms.tradeOffers( {
			npcId: 'a1', cards: [ { itemId: 'card:home:p1/f/u1', name: 'Kessler Block key card' } ],
			questItems: [ { itemId: 'DRINK_WHISKY_KESSEL', name: 'amber whisky' } ], offered: 10,
			counter: { venueType: 'restaurant', menu: menuOf( 'restaurant', 'rich' ) }
		} );
		expect( offers.give.items[ 0 ] ).toEqual( { itemId: 'card:home:p1/f/u1', name: 'Kessler Block key card', copy: true } );
		expect( offers.give.items.map( ( item ) => item.itemId ) ).toContain( 'carry:effect' );
		expect( offers.give.items.map( ( item ) => item.itemId ) ).not.toContain( 'carry:phone' );
		expect( offers.take.items ).toEqual( [ { itemId: 'own:card-staff-p9', name: 'Ostbank staff card' }, { itemId: 'quest:DRINK_WHISKY_KESSEL', name: 'amber whisky' } ] );
		expect( offers.credits ).toEqual( { carried: holdings.of( 'a1' ).credits, purse: 40, offered: 10 } );
		expect( offers.sell.items.find( ( item ) => item.itemId === 'whisky' ) ).toEqual( { itemId: 'whisky', name: 'glass of whisky', price: 18 } );
		expect( offers ).not.toHaveProperty( 'buy' );
		expect( terms.tradeOffers( { npcId: 'a1' } ) ).not.toHaveProperty( 'sell' );

	} );

} );
