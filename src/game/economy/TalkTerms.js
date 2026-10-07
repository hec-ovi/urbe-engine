/** Most things a talk is told a person carries, and most of each list of things on offer. */
const MAX_ITEMS = 12;
const MAX_SELL = 8;
/** Counters at which a person buys from a till, at half a thing's worth. */
const TILLS = new Set( [ 'commerce', 'mall' ] );

/**
 * What a talk is told about what changes hands: what the person carries
 * (`carry`, so they never give what they do not have) and what they may
 * give, take, pay, sell or buy this turn (the talk's `offers`).
 */
export class TalkTerms {

	/**
	 * @param ports.holdings every person's Holdings
	 * @param ports.wallet the player's Wallet
	 * @param ports.items the player's PlayerItems
	 */
	constructor( { holdings, wallet, items } ) {

		Object.assign( this, { holdings, wallet, items } );

	}

	/**
	 * The talk's `carry` for a person: `{ credits, means, items, dealings?, asked? }`,
	 * `items` what they have on them but their cards (the talk's addresses tell
	 * those), a thing the player gave them `from: 'stranger'`; null for nobody known.
	 */
	carryContext( npcId ) {

		const now = this.holdings.of( npcId );
		if ( ! now ) return null;
		const items = now.things.filter( ( thing ) => ! thing.slot.startsWith( 'card:' ) ).slice( 0, MAX_ITEMS ).map( ( thing ) => ( {
			name: words( thing.name ), ...( thing.from ? { from: 'stranger' } : {} ), ...( Number.isFinite( thing.atMin ) ? { atMin: thing.atMin } : {} )
		} ) );
		const asked = this.holdings.asked( npcId );
		return {
			credits: now.credits, means: now.means, items,
			...( now.dealt.length ? { dealings: now.dealt.map( ( entry ) => ( { ...entry, ...( entry.name ? { name: words( entry.name ) } : {} ) } ) ) } : {} ),
			...( asked ? { asked } : {} )
		};

	}

	/**
	 * What a person may agree to hand over or take this turn, face to face:
	 * `give` the card copies they hold and the player lacks and the things
	 * they could part with (`carry:<slot>`); `take` the player's own items
	 * (`own:<id>`) and the story items a story lets the player hand them
	 * (`quest:<itemId>`); `credits` what they and the player have on them,
	 * with what the player holds out; at a counter `sell` its menu; `buy` the
	 * player's things that are worth something, half that at a shop's or a
	 * mall's till, else what they can pay. A key is left out when it offers nothing.
	 * @param options.cards `[{ itemId: 'card:<scope>', name }]`, GameApp `#cardOffers`
	 * @param options.questItems `[{ itemId, name }]`, the story items handable to this person
	 * @param options.counter GameApp `#counter`, or null away from one
	 * @param options.offered credits the player holds out, or null
	 */
	tradeOffers( { npcId, cards = [], questItems = [], counter = null, offered = null } ) {

		const now = this.holdings.of( npcId );
		if ( ! now ) return {};
		const offers = {};
		const things = now.things.filter( ( thing ) => thing.giftable && ! thing.slot.startsWith( 'card:' ) );
		const give = [
			...cards.map( ( card ) => ( { ...card, copy: true } ) ),
			...things.map( ( thing ) => ( { itemId: `carry:${thing.slot}`, name: words( thing.name ) } ) )
		].slice( 0, MAX_ITEMS );
		if ( give.length ) offers.give = { items: give };
		const take = [
			...this.items.list().map( ( item ) => ( { itemId: `own:${item.id}`, name: words( item.label ) } ) ),
			...questItems.map( ( item ) => ( { itemId: `quest:${item.itemId}`, name: words( item.name ) } ) )
		].slice( 0, MAX_ITEMS );
		if ( take.length ) offers.take = { items: take };
		offers.credits = { carried: now.credits, purse: this.wallet.credits, ...( offered >= 1 ? { offered } : {} ) };
		if ( counter?.menu?.length ) offers.sell = { items: counter.menu.slice( 0, MAX_SELL ).map( ( good ) => ( { itemId: good.goodId, name: words( good.name ), price: good.price } ) ) };
		const till = Boolean( counter && TILLS.has( counter.venueType ) );
		const buy = this.items.list().flatMap( ( item ) => {

			const price = offerPrice( item, { till, carried: now.credits } );
			return price >= 1 ? [ { itemId: `own:${item.id}`, name: words( item.label ), price } ] : [];

		} ).slice( 0, MAX_ITEMS );
		if ( buy.length ) offers.buy = { items: buy };
		return offers;

	}

}

/** What one of the player's things is worth: goods what they cost, an effect its own worth; a card or a story's item nothing. */
export function worthOf( item ) {

	if ( item?.kind === 'goods' ) return Math.max( 0, Math.floor( item.data?.price ?? 0 ) );
	if ( item?.kind === 'effect' ) return Math.max( 0, Math.floor( item.data?.worth ?? 0 ) );
	return 0;

}

/** What a person would pay for one of the player's things: half its worth at a till, else its worth up to what they carry. */
export function offerPrice( item, { till = false, carried = 0 } = {} ) {

	const worth = worthOf( item );
	return till ? Math.floor( worth / 2 ) : Math.min( worth, carried );

}

/** Whether a counter buys from a till, a shop's or a mall's. */
export function hasTill( counter ) {

	return Boolean( counter && TILLS.has( counter.venueType ) );

}

function words( text ) {

	return String( text ?? '' ).trim().slice( 0, 200 ) || 'something';

}
