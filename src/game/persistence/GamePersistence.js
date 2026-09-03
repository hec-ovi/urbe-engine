import { PersistenceError } from './PersistenceError.js';
import { SchemaBoundary } from './SchemaBoundary.js';

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

	/** Serializes saves so every request uses the last confirmed revision. */
	save( live ) {

		const run = () => this.#save( live );
		this.pending = this.pending.catch( () => undefined ).then( run );
		return this.pending;

	}

	async #save( live ) {

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
			...( Object.hasOwn( live, 'transitJourney' )
				? { transitJourney: live.transitJourney }
				: Object.hasOwn( this.game, 'transitJourney' ) ? { transitJourney: this.game.transitJourney } : {} ),
			...( Object.hasOwn( live, 'npcState' )
				? { npcState: live.npcState }
				: Object.hasOwn( this.game, 'npcState' ) ? { npcState: this.game.npcState } : {} )
		};
		this.boundary.assert( 'save-current-payload', payload, 'E_SAVE_PAYLOAD', 'saveCurrent payload' );

		let response;
		try {

			response = await Reflect.apply( this.fetcher, globalThis, [ '/api/launcher', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { method: 'saveCurrent', input: payload } )
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

/** Retains ordinary items and replaces quest-owned items with the runtime inventory. */
export function mergeInventory( saved, questItems, questItemIds ) {

	const managed = new Set( questItemIds );
	const merged = new Map();
	for ( const item of saved ) if ( ! managed.has( item.id ) ) merged.set( item.id, item );
	for ( const item of questItems ) merged.set( item.id, item );
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
