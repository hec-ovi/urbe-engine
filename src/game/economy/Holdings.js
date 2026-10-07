/** Kinds a person took from the player that stay with them: a card is the player's own copy, a story's item is the story's. */
export const KEPT_KINDS = Object.freeze( [ 'access-card', 'story' ] );
/** Most people whose holdings a save keeps, and most of each list a person's keeps. */
const MAX_PEOPLE = 300;
const MAX_GONE = 16;
const MAX_GOT = 16;
const MAX_DEALT = 8;

/**
 * What every person carries now: what `base(npcId)` works out for them
 * (Carry `carryOf`), until something changes it; from then on a snapshot
 * of that person, `{ npcId, credits, gone, got, dealt }`, which the save
 * keeps: their credits, the slots of what left them (`gone`), what they
 * took from the player (`got`, `{ id, name, kind, atMin? }`) and the
 * latest dealings between them, told from their side (`dealt`). A sum a
 * person asked for and was not paid is kept for this session only.
 */
export class Holdings {

	/** @param base `(npcId) => { credits, means, things } | null`, what a person carries before any change */
	constructor( { base } ) {

		this.base = base;
		/** Changed people by npcId, the most recently changed last. */
		this.people = new Map();
		this.asks = new Map();

	}

	/**
	 * What a person carries now: `{ credits, means, things, gone, got, dealt }`,
	 * `things` without what is gone and with what they got from the player
	 * (slot `got:<id>`, `from: 'stranger'`); null for nobody `base` knows.
	 */
	of( npcId ) {

		const base = this.base( npcId );
		if ( ! base ) return null;
		const snapshot = this.people.get( npcId );
		if ( ! snapshot ) return { ...base, things: base.things.map( ( thing ) => ( { ...thing } ) ), gone: [], got: [], dealt: [] };
		const gone = new Set( snapshot.gone );
		return {
			credits: snapshot.credits, means: base.means,
			things: [
				...base.things.filter( ( thing ) => ! gone.has( thing.slot ) ).map( ( thing ) => ( { ...thing } ) ),
				...snapshot.got.map( ( thing ) => ( {
					slot: `got:${thing.id}`, kind: thing.kind, name: thing.name, worth: 0, giftable: ! KEPT_KINDS.includes( thing.kind ), from: 'stranger', sort: thing.kind,
					...( Number.isFinite( thing.atMin ) ? { atMin: thing.atMin } : {} )
				} ) )
			],
			gone: [ ...snapshot.gone ], got: snapshot.got.map( ( thing ) => ( { ...thing } ) ), dealt: snapshot.dealt.map( ( entry ) => ( { ...entry } ) )
		};

	}

	/** Takes up to `n` credits from a person: what they had to give, 0 for nobody known. */
	debit( npcId, n ) {

		const now = this.of( npcId );
		if ( ! now ) return 0;
		const taken = Math.max( 0, Math.min( Math.floor( n ), now.credits ) );
		if ( taken ) this.#change( npcId, ( snapshot ) => { snapshot.credits -= taken; } );
		return taken;

	}

	/** Gives a person `n` credits. */
	credit( npcId, n ) {

		if ( ! this.of( npcId ) || ! ( n > 0 ) ) return false;
		this.#change( npcId, ( snapshot ) => { snapshot.credits += Math.floor( n ); } );
		return true;

	}

	/** Takes the thing in `slot` from a person: the thing, or null when they do not carry it. */
	remove( npcId, slot ) {

		const thing = this.of( npcId )?.things.find( ( candidate ) => candidate.slot === slot ) ?? null;
		if ( ! thing ) return null;
		this.#change( npcId, ( snapshot ) => {

			if ( slot.startsWith( 'got:' ) ) snapshot.got = snapshot.got.filter( ( entry ) => `got:${entry.id}` !== slot );
			else if ( ! snapshot.gone.includes( slot ) ) snapshot.gone = [ ...snapshot.gone, slot ].slice( - MAX_GONE );

		} );
		return thing;

	}

	/** A person takes a thing from the player: `{ id, name, kind, atMin? }`; one of an id, the newest kept. */
	add( npcId, thing ) {

		if ( ! this.of( npcId ) ) return false;
		const entry = {
			id: String( thing.id ).slice( 0, 64 ), name: String( thing.name ).slice( 0, 120 ), kind: String( thing.kind ?? '' ).slice( 0, 32 ),
			...( Number.isFinite( thing.atMin ) ? { atMin: Math.max( 0, thing.atMin ) } : {} )
		};
		this.#change( npcId, ( snapshot ) => {

			snapshot.got = [ ...snapshot.got.filter( ( got ) => got.id !== entry.id ), entry ].slice( - MAX_GOT );

		} );
		return true;

	}

	/** Notes a dealing between a person and the player, from their side: `{ what, amount?, name?, atMin }`. */
	deal( npcId, entry ) {

		if ( ! this.of( npcId ) ) return false;
		const dealt = {
			what: entry.what, ...( entry.amount >= 1 ? { amount: Math.floor( entry.amount ) } : {} ),
			...( entry.name ? { name: String( entry.name ).slice( 0, 120 ) } : {} ), atMin: Math.max( 0, entry.atMin ?? 0 )
		};
		this.#change( npcId, ( snapshot ) => { snapshot.dealt = [ ...snapshot.dealt, dealt ].slice( - MAX_DEALT ); } );
		return true;

	}

	/** A person asks the player for `n` credits; the ask stands until paid or the session ends. */
	ask( npcId, n ) {

		if ( Number.isInteger( n ) && n >= 1 ) this.asks.set( npcId, n );

	}

	/** The credits a person asked for and has not been paid, or null. */
	asked( npcId ) {

		return this.asks.get( npcId ) ?? null;

	}

	/** The ask is paid, or let go. */
	settle( npcId ) {

		this.asks.delete( npcId );

	}

	/** How many people carry something other than what they started with. */
	get changed() {

		return this.people.size;

	}

	/** The save's `people`: every changed person, by npcId, the MAX_PEOPLE changed last. */
	serialize() {

		return [ ...this.people.values() ].slice( - MAX_PEOPLE ).sort( ( a, b ) => a.npcId.localeCompare( b.npcId ) ).map( ( snapshot ) => ( {
			npcId: snapshot.npcId, credits: snapshot.credits, gone: [ ...snapshot.gone ], got: snapshot.got.map( ( thing ) => ( { ...thing } ) ),
			...( snapshot.dealt.length ? { dealt: snapshot.dealt.map( ( entry ) => ( { ...entry } ) ) } : {} )
		} ) );

	}

	restore( people = [] ) {

		this.people.clear();
		this.asks.clear();
		for ( const saved of people ) {

			if ( ! saved?.npcId ) continue;
			this.people.set( saved.npcId, {
				npcId: saved.npcId, credits: Math.max( 0, Math.floor( saved.credits ?? 0 ) ),
				gone: [ ...new Set( saved.gone ?? [] ) ].slice( - MAX_GONE ),
				got: ( saved.got ?? [] ).slice( - MAX_GOT ).map( ( thing ) => ( { ...thing } ) ),
				dealt: ( saved.dealt ?? [] ).slice( - MAX_DEALT ).map( ( entry ) => ( { ...entry } ) )
			} );

		}
		return this;

	}

	/** A person's snapshot, made from what they carried on their first change, changed and moved to the most recent. */
	#change( npcId, change ) {

		let snapshot = this.people.get( npcId );
		if ( ! snapshot ) snapshot = { npcId, credits: this.base( npcId ).credits, gone: [], got: [], dealt: [] };
		this.people.delete( npcId );
		change( snapshot );
		this.people.set( npcId, snapshot );

	}

}
