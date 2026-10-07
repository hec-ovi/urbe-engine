import { PersistenceError } from './PersistenceError.js';
import { carriedFields } from './SavedFields.js';
import { SchemaBoundary } from './SchemaBoundary.js';

const KEEPALIVE_BYTES = 60000;

/** A loaded catalog game plus its revision-safe browser save transport. */
export class GamePersistence {

	constructor( { game, gameId, fetcher = globalThis.fetch, now = () => new Date() } ) {

		this.boundary = new SchemaBoundary();
		this.boundary.assert( 'game-state', game, 'E_GAME_STATE', 'loaded game' );
		if ( game.id !== gameId ) throw new PersistenceError( 'E_GAME_STATE', `loaded game ${game.id} does not match requested game ${gameId}` );
		if ( typeof fetcher !== 'function' ) throw new PersistenceError( 'E_GAME_STATE', 'save transport is unavailable' );

		this.game = game;
		this.fetcher = fetcher;
		this.now = now;
		this.pending = Promise.resolve();
		this.savedElapsedSeconds = 0;

	}

	/** A new game: nothing has been saved with play time yet. */
	get unplayed() {

		return this.game.save.playTimeSeconds === 0;

	}

	/**
	 * Serializes saves so every request uses the last confirmed revision.
	 * `keepalive` lets the request outlive the page, as a page being left
	 * needs, when its body is small enough for the browser to keep it.
	 */
	save( live, { keepalive = false } = {} ) {

		const run = () => this.#save( live, keepalive );
		this.pending = this.pending.catch( () => undefined ).then( run );
		return this.pending;

	}

	async #save( live, keepalive = false ) {

		this.boundary.assert( 'live-state', live, 'E_LIVE_STATE', 'live game state' );
		const payload = {
			gameId: this.game.id,
			expectedRevision: this.game.save.revision,
			updatedAt: this.now().toISOString(),
			playTimeSeconds: this.game.save.playTimeSeconds + Math.max( 0, live.elapsedSeconds - this.savedElapsedSeconds ),
			player: {
				position: live.position,
				heading: live.heading,
				inventory: live.inventory
			},
			quests: live.quests,
			sideJobs: live.sideJobs,
			currentLocation: live.currentLocation,
			discoveredLocations: uniqueLocations( [ ...live.discoveredLocations, live.currentLocation ] ),
			...carriedFields( live, this.game )
		};
		this.boundary.assert( 'save-current-payload', payload, 'E_SAVE_PAYLOAD', 'saveCurrent payload' );

		let response;
		try {

			const body = JSON.stringify( { method: 'saveCurrent', input: payload } );
			response = await Reflect.apply( this.fetcher, globalThis, [ '/api/launcher', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body,
				// A browser keeps at most 64 KiB in flight for a page that is going away.
				...( keepalive && body.length < KEEPALIVE_BYTES ? { keepalive: true } : {} )
			} ] );

		} catch ( error ) {

			throw new PersistenceError( 'E_SAVE_HTTP', `could not save game: ${messageOf( error )}` );

		}

		const result = await response.json().catch( () => null );
		if ( ! response.ok ) throw new PersistenceError( 'E_SAVE_HTTP', result?.message ?? `save failed with HTTP ${response.status}` );
		this.boundary.assert( 'save-result', result, 'E_SAVE_RESPONSE', 'saved game response' );
		if ( result.id !== this.game.id || result.save.revision !== payload.expectedRevision + 1 ) {

			throw new PersistenceError( 'E_SAVE_RESPONSE', 'saved game response has the wrong id or revision' );

		}
		this.game = result;
		this.savedElapsedSeconds = Math.max( this.savedElapsedSeconds, live.elapsedSeconds );
		return result;

	}

}

/** The save's ids are lower-case words of letters, digits, dots, dashes and underscores, at most 64 long. */
const ID_LENGTH = 64;

/**
 * A quest item's id as the save takes it: lower case, anything but letters,
 * digits, dots, dashes and underscores a dash, no punctuation at either end,
 * `q-` before one that would not start with a letter or digit, and past 64
 * characters cut and finished with a hash of the whole id (the scheme of
 * Access `cardId`). `ACCESS_CARD_CLERK` is `access_card_clerk`; the same id
 * is always the same save id.
 */
export function saveItemId( itemId ) {

	const raw = String( itemId ?? '' );
	let words = raw.toLowerCase().replace( /[^a-z0-9._-]+/g, '-' ).replace( /^[^a-z0-9]+|[^a-z0-9]+$/g, '' );
	// An id of punctuation alone has no word left to start with.
	if ( ! /^[a-z0-9]/.test( words ) ) words = words ? `q-${words}` : 'q-item';
	if ( words.length <= ID_LENGTH ) return words;
	let hash = 2166136261;
	for ( const char of raw ) hash = Math.imul( hash ^ char.charCodeAt( 0 ), 16777619 );
	const tail = ( hash >>> 0 ).toString( 36 );
	return `${words.slice( 0, ID_LENGTH - tail.length - 1 ).replace( /[^a-z0-9]+$/, '' )}-${tail}`;

}

/**
 * Retains ordinary items and replaces quest-owned items with the runtime
 * inventory. A quest item is saved by its `saveItemId`, its own id kept in
 * `state.itemId`; a saved entry under either id is the quests'.
 */
export function mergeInventory( saved, questItems, questItemIds ) {

	const managed = new Set( [ ...questItemIds, ...questItemIds.map( saveItemId ) ] );
	const merged = new Map();
	for ( const item of saved ) if ( ! managed.has( item.id ) ) merged.set( item.id, item );
	for ( const item of questItems ) {

		const id = saveItemId( item.id );
		merged.set( id, { ...item, id, state: { ...item.state, itemId: item.id } } );

	}
	return [ ...merged.values() ];

}

/** Replaces progress for running quests while retaining any quest the runtime could not cast. */
export function mergeProgress( game, liveProgress ) {

	const live = new Map( liveProgress.map( ( progress ) => [ progress.id, progress ] ) );
	const replace = ( records ) => records.map( ( record ) => live.get( record.id ) ?? record );
	return { quests: replace( game.quests ), sideJobs: replace( game.sideJobs ) };

}

export function uniqueLocations( locations ) {

	const unique = new Map();
	for ( const location of locations ) unique.set( location.id, location );
	return [ ...unique.values() ];

}

function messageOf( error ) {

	return error instanceof Error ? error.message : String( error );

}
