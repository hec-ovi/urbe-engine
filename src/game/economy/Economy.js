import { economyLines } from './EconomyLines.js';
import { Holdings } from './Holdings.js';
import { TalkTerms } from './TalkTerms.js';
import { Trades } from './Trades.js';
import { Wallet, paydaysBy } from './Wallet.js';

/** Most payments the save remembers having made. */
const MAX_SETTLED = 400;

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
