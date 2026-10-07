import { saveItemId } from '../persistence/GamePersistence.js';
import { POCKET_SLOTS, draw } from './Carry.js';
import { KEPT_KINDS } from './Holdings.js';

/** What a hand in a pocket comes out with, by weight, renormalised over what the person has. */
const LIFT_WEIGHTS = Object.freeze( { credits: 0.5, card: 0.25, thing: 0.25 } );

/**
 * The commit side of every transfer between the player and a person: credits
 * and things move between the wallet, the player's items and what the person
 * carries, or nothing moves and the result says why. Every result is
 * `{ ok, kind, amount?, name?, thing?, moved?, reason? }`, `kind` one of
 * `paid`, `received`, `given`, `got`, `bought`, `sold`, `lifted`. Nothing
 * here touches the screen.
 */
export class Trades {

	/**
	 * @param ports.wallet the player's Wallet
	 * @param ports.holdings every person's Holdings
	 * @param ports.items the player's PlayerItems
	 * @param ports.quests `{ handable( itemId, npcId, place ), hand( itemId, npcId, place, timeMin ) }`, QuestSession
	 * @param ports.now `() => timeMin`
	 * @param ports.nameOf `(npcId) => name`, how the player knows the person
	 * @param ports.card `(scope, { npcId, name, how, atMin }) => item | null`, Access `cardFor`
	 */
	constructor( { wallet, holdings, items, quests = null, now = () => 0, nameOf = () => 'someone', card = () => null } ) {

		Object.assign( this, { wallet, holdings, items, quests, now, nameOf, card } );

	}

	/**
	 * The player hands a person one of their things: one of their own items
	 * (`own:<id>`), which leaves the player and joins what the person got, or
	 * a story's item (`quest:<itemId>`), which its story takes (QuestSession
	 * `hand`) as it allows at `place`.
	 */
	hand( npcId, inventoryId, place = null ) {

		const atMin = this.now();
		const name = this.nameOf( npcId );
		if ( String( inventoryId ).startsWith( 'quest:' ) ) {

			const itemId = String( inventoryId ).slice( 'quest:'.length );
			let handed = null;
			try {

				handed = this.quests?.hand?.( itemId, npcId, place, atMin ) ?? null;

			} catch {

				handed = null;

			}
			if ( ! handed ) return { ok: false, kind: 'given', reason: 'refused' };
			const thing = { id: saveItemId( itemId ), name: handed.name ?? itemId, kind: 'story', atMin };
			this.holdings.add( npcId, thing );
			this.holdings.deal( npcId, { what: 'got-thing', name: thing.name, atMin } );
			return { ok: true, kind: 'given', name: thing.name, to: name, thing, moved: handed.moved ?? [], how: handed.how, questId: handed.questId };

		}
		const id = String( inventoryId ).replace( /^own:/, '' );
		const item = this.items.get( id );
		if ( ! item ) return { ok: false, kind: 'given', reason: 'missing' };
		if ( ! this.holdings.of( npcId ) ) return { ok: false, kind: 'given', reason: 'nobody' };
		this.items.take( id );
		const thing = { id: item.id, name: item.label, kind: item.kind, atMin };
		this.holdings.add( npcId, thing );
		this.holdings.deal( npcId, { what: 'got-thing', name: item.label, atMin } );
		return { ok: true, kind: 'given', name: item.label, to: name, thing };

	}

	/** The player pays a person `n` credits for `what`; nothing moves when the wallet is short. */
	pay( npcId, n, what = '' ) {

		const amount = Math.floor( n );
		const name = this.nameOf( npcId );
		if ( ! ( amount >= 1 ) || ! this.holdings.of( npcId ) ) return { ok: false, kind: 'paid', reason: 'nobody' };
		if ( ! this.wallet.spend( amount, { atMin: this.now(), what: 'paid', npcId, name } ) ) return { ok: false, kind: 'paid', amount, reason: 'short' };
		this.holdings.credit( npcId, amount );
		this.holdings.deal( npcId, { what: 'got-credits', amount, atMin: this.now() } );
		this.holdings.settle( npcId );
		return { ok: true, kind: 'paid', amount, name, what };

	}

	/** A person pays the player `n` credits, no more than they carry. */
	receive( npcId, n, what = '' ) {

		const name = this.nameOf( npcId );
		const amount = this.holdings.debit( npcId, Math.floor( n ) );
		if ( ! amount ) return { ok: false, kind: 'received', reason: 'empty' };
		this.wallet.add( amount, { atMin: this.now(), what: 'received', npcId, name } );
		this.holdings.deal( npcId, { what: 'gave-credits', amount, atMin: this.now() } );
		return { ok: true, kind: 'received', amount, name, what };

	}

	/** A person hands the player one of their things (`slot`, not a card: cards are given as copies): it leaves them and is the player's. */
	receiveThing( npcId, slot ) {

		const name = this.nameOf( npcId );
		const thing = this.holdings.of( npcId )?.things.find( ( candidate ) => candidate.slot === slot ) ?? null;
		if ( ! thing || ! thing.giftable || thing.kind === 'access-card' || KEPT_KINDS.includes( thing.kind ) ) return { ok: false, kind: 'got', reason: 'missing' };
		this.holdings.remove( npcId, slot );
		const item = this.#effect( npcId, thing, 'given' );
		this.items.stack( item );
		this.holdings.deal( npcId, { what: 'gave-thing', name: thing.label ?? thing.name, atMin: this.now() } );
		return { ok: true, kind: 'got', name: item.label, from: name, thing, itemId: item.id };

	}

	/**
	 * The player buys a good off a counter's menu (`counter`, GameApp
	 * `#counter`): the price leaves the wallet into the till and the good
	 * joins the player's goods, one more of the same.
	 */
	buy( counter, goodId ) {

		const good = counter?.menu?.find( ( entry ) => entry.goodId === goodId );
		if ( ! good ) return { ok: false, kind: 'bought', reason: 'missing' };
		const payee = counter.payee ?? counter.name ?? null;
		if ( ! this.wallet.spend( good.price, { atMin: this.now(), what: 'bought', ...( counter.npcId ? { npcId: counter.npcId } : {} ), name: payee ?? good.name } ) ) {

			return { ok: false, kind: 'bought', amount: good.price, name: good.name, reason: 'short' };

		}
		const item = goodsItem( good, counter, this.now() );
		this.items.stack( item );
		return { ok: true, kind: 'bought', amount: good.price, name: good.name, payee, itemId: item.id };

	}

	/**
	 * A person buys one of the player's things for `n`: from a till, or out
	 * of their own pocket when they carry it, the thing then theirs.
	 */
	sell( npcId, inventoryId, n, till = false ) {

		const id = String( inventoryId ).replace( /^own:/, '' );
		const item = this.items.get( id );
		const amount = Math.floor( n );
		const name = this.nameOf( npcId );
		if ( ! item || ! ( amount >= 1 ) ) return { ok: false, kind: 'sold', reason: 'missing' };
		if ( ! till && ( this.holdings.of( npcId )?.credits ?? 0 ) < amount ) return { ok: false, kind: 'sold', amount, reason: 'short' };
		this.items.take( id );
		if ( ! till ) {

			this.holdings.debit( npcId, amount );
			this.holdings.add( npcId, { id: item.id, name: item.label, kind: item.kind, atMin: this.now() } );
			this.holdings.deal( npcId, { what: 'got-thing', name: item.label, atMin: this.now() } );

		}
		this.wallet.add( amount, { atMin: this.now(), what: 'sold', npcId, name } );
		return { ok: true, kind: 'sold', amount, name: item.label, to: name };

	}

	/**
	 * What a successful lift takes off a person (Access `pickpocket` decided
	 * that it worked): credits, a card the player lacks or a thing from their
	 * pockets, drawn by LIFT_WEIGHTS over what they have, by the seed. Credits
	 * come out as a fold of what they carry; a card as the player's stolen
	 * copy, gone from them; a thing as one of the player's effects.
	 * @param lackedScopes the scopes the person holds and the player lacks, home first
	 */
	lift( npcId, seed, lackedScopes = [] ) {

		const now = this.holdings.of( npcId );
		if ( ! now ) return { ok: false, kind: 'lifted', reason: 'nobody' };
		const name = this.nameOf( npcId );
		const gone = new Set( now.gone );
		const scopes = lackedScopes.filter( ( scope ) => ! gone.has( `card:${scope}` ) );
		const pockets = now.things.filter( ( thing ) => POCKET_SLOTS.includes( thing.slot ) );
		const have = { credits: now.credits > 0, card: scopes.length > 0, thing: pockets.length > 0 };
		const total = Object.keys( LIFT_WEIGHTS ).reduce( ( sum, key ) => sum + ( have[ key ] ? LIFT_WEIGHTS[ key ] : 0 ), 0 );
		if ( ! total ) return { ok: false, kind: 'lifted', reason: 'empty' };
		let roll = draw( seed, 'what' ) * total;
		const what = Object.keys( LIFT_WEIGHTS ).filter( ( key ) => have[ key ] ).find( ( key ) => ( roll -= LIFT_WEIGHTS[ key ] ) < 0 ) ?? 'credits';
		const atMin = this.now();
		if ( what === 'credits' ) {

			const amount = this.holdings.debit( npcId, Math.max( 1, Math.ceil( now.credits * ( 0.3 + 0.4 * draw( seed, 'fold' ) ) ) ) );
			this.wallet.add( amount, { atMin, what: 'lifted', npcId, name } );
			return { ok: true, kind: 'lifted', amount, from: name };

		}
		if ( what === 'card' ) {

			const card = this.card( scopes[ 0 ], { npcId, name, how: 'stolen', atMin } );
			if ( ! card ) return { ok: false, kind: 'lifted', reason: 'empty' };
			this.items.add( card );
			this.holdings.remove( npcId, `card:${scopes[ 0 ]}` );
			return { ok: true, kind: 'lifted', name: card.label, from: name, itemId: card.id, card };

		}
		const thing = pockets[ Math.floor( draw( seed, 'thing' ) * pockets.length ) ];
		this.holdings.remove( npcId, thing.slot );
		const item = this.#effect( npcId, thing, 'stolen' );
		this.items.stack( item );
		return { ok: true, kind: 'lifted', name: item.label, from: name, itemId: item.id, thing };

	}

	/** One of a person's things as the player's item: an `effect` named as the player reads it, with whose it was, how it came and its worth. */
	#effect( npcId, thing, how ) {

		return {
			id: saveItemId( `effect-${npcId}-${thing.slot}` ), kind: 'effect', label: capital( thing.label ?? thing.name ),
			data: { sort: thing.sort ?? thing.kind, from: { npcId, name: this.nameOf( npcId ) }, how, worth: thing.worth ?? 0, atMin: this.now() }
		};

	}

}

/** A good bought at a counter as the player's item: one stack per good, the latest price and place kept. */
export function goodsItem( good, counter, atMin ) {

	return {
		id: saveItemId( `goods-${good.goodId}` ), kind: 'goods', label: capital( good.name ),
		data: { goodId: good.goodId, price: good.price, at: counter?.name ?? '', ...( counter?.parcelId ? { parcelId: counter.parcelId } : {} ), atMin }
	};

}

function capital( text ) {

	const words = String( text ?? '' ).replace( /^(a|an|the|your)\s+/i, '' );
	return words.charAt( 0 ).toUpperCase() + words.slice( 1 );

}
