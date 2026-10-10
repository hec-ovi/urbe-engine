import { economyLines } from './EconomyLines.js';
import { Holdings } from './Holdings.js';
import { TalkTerms } from './TalkTerms.js';
import { Trades } from './Trades.js';
import { Wallet, paydaysBy } from './Wallet.js';
import { WAGE } from './Prices.js';

/** Most payments the save remembers having made. */
const MAX_SETTLED = 400;
/** What a side story's person pays the player when it ends, by their means, never more than they carry. */
export const REWARD = Object.freeze( { short: 5, 'getting-by': 10, comfortable: 20, 'well-off': 40 } );

/**
 * Everything credits in one game: the player's wallet, what every person
 * carries (`holdings`), the payments made once (`settled`: `reward:<questId>`,
 * `shift:<questId>/<stepId>`), the commit side of transfers (`trades`), what
 * a talk is told (`terms`) and the words (`lines`). The save's `economy`
 * field is `serialize()`; `restore` takes it back.
 */
export class Economy {

	/** @param ports what Trades needs of the game: items, quests, now, nameOf, card */
	constructor( { wallet, holdings, settled = [], ports = {} } ) {

		this.wallet = wallet;
		this.holdings = holdings;
		this.settled = new Set( settled );
		this.lines = economyLines();
		this.terms = new TalkTerms( { holdings, wallet, items: ports.items } );
		this.trades = new Trades( { wallet, holdings, ...ports } );

	}

	/** Marks a payment made: true the first time, false when it was made before. */
	settle( key ) {

		if ( this.settled.has( key ) ) return false;
		this.settled.add( key );
		return true;

	}

	/**
	 * Pays what a story owes once (QuestSession `settlements`): a `shift`
	 * booked by the Bureau, a `reward` from the person the side job was for,
	 * by their means and no more than they carry. `{ kind, amount, npcId?, name? }`,
	 * or null when it was paid before or there is nothing to pay; either way
	 * it is settled from then on.
	 */
	owe( due ) {

		if ( ! due?.key || ! this.settle( due.key ) ) return null;
		const atMin = this.trades.now();
		if ( due.kind === 'shift' ) {

			this.wallet.add( WAGE.shift, { atMin, what: 'shift', name: 'the Bureau' } );
			return { kind: 'shift', amount: WAGE.shift };

		}
		const now = due.npcId ? this.holdings.of( due.npcId ) : null;
		const amount = this.holdings.debit( due.npcId, Math.min( REWARD[ now?.means ] ?? 0, now?.credits ?? 0 ) );
		if ( ! amount ) return null;
		const name = this.trades.nameOf( due.npcId );
		this.wallet.add( amount, { atMin, what: 'reward', npcId: due.npcId, name } );
		this.holdings.deal( due.npcId, { what: 'gave-credits', amount, atMin } );
		return { kind: 'reward', amount, npcId: due.npcId, name };

	}

	/** The save's `economy`. */
	serialize() {

		const wallet = this.wallet.serialize();
		return {
			credits: wallet.credits, paidWeek: wallet.paidWeek, settled: [ ...this.settled ].slice( - MAX_SETTLED ),
			people: this.holdings.serialize(), log: wallet.log
		};

	}

	/**
	 * The economy a save carries, or for a save made before it the starting
	 * credits with no pay owed for the weeks gone by and every reward and
	 * shift done so far (`completedSettled`) counted as paid, so nothing is
	 * paid for the past.
	 * @param options.timeMin the game minute the save resumes at
	 * @param options.base `(npcId) => carry | null`, what a person carries before any change (Carry `carryOf`)
	 */
	static restore( saved, { timeMin = 0, completedSettled = [], base = () => null, ...ports } = {} ) {

		const wallet = Wallet.restore( saved ? { credits: saved.credits, paidWeek: saved.paidWeek ?? paydaysBy( timeMin ), log: saved.log ?? [] } : undefined, timeMin );
		const holdings = new Holdings( { base } ).restore( saved?.people ?? [] );
		return new Economy( { wallet, holdings, settled: saved ? saved.settled ?? [] : completedSettled, ports } );

	}

}
