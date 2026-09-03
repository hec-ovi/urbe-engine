import { canonicalClone, canonicalJson } from './canonicalJson.js';
import { LibraryError } from './LibraryError.js';

const VERSION = '1.0.0';
const SAFE_ID = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const SAFE_RESOURCE_PART = /^[A-Za-z0-9._-]+$/;

export class CatalogLibrary {

	#writes = new Map();

	constructor( store, boundary ) {

		this.store = store;
		this.boundary = boundary;

	}

	async discover( query = {} ) {

		this.boundary.assert( 'query', query, 'E_INVALID_REQUEST', 'discover request' );
		const cityCatalog = await this.listCities();
		const gameCatalog = await this.listGames();
		const result = { contractVersion: VERSION, cities: cityCatalog.items, games: gameCatalog.items };
		this.boundary.assert( 'library-catalog', result, 'E_INVALID_DESCRIPTOR', 'library catalog' );
		return result;

	}

	async listCities( query = {} ) {

		this.boundary.assert( 'query', query, 'E_INVALID_REQUEST', 'city list request' );
		const ids = await this.store.listIds( 'cities' );
		const items = [];
		for ( const id of ids ) {

			assertSafeId( id );
			items.push( await this.#loadCity( id ) );

		}
		const result = { contractVersion: VERSION, items };
		this.boundary.assert( 'city-catalog', result, 'E_INVALID_DESCRIPTOR', 'city catalog' );
		return result;

	}

	async listGames( query = {} ) {

		this.boundary.assert( 'query', query, 'E_INVALID_REQUEST', 'game list request' );
		const ids = await this.store.listIds( 'games' );
		const items = [];
		for ( const id of ids ) {

			assertSafeId( id );
			items.push( await this.#loadGame( id ) );

		}
		const result = { contractVersion: VERSION, items };
		this.boundary.assert( 'game-catalog', result, 'E_INVALID_DESCRIPTOR', 'game catalog' );
		return result;

	}

	async loadCity( reference ) {

		const id = this.#reference( reference, 'city' );
		return this.#loadCity( id );

	}

	async loadGame( reference ) {

		const id = this.#reference( reference, 'game' );
		return this.#loadGame( id );

	}

	async saveCity( city ) {

		const id = city?.id;
		if ( typeof id === 'string' && ! SAFE_ID.test( id ) ) assertSafeId( id );
		this.boundary.assert( 'city-descriptor', city, 'E_INVALID_REQUEST', 'city save request' );
		this.#assertCitySemantics( city, 'E_INVALID_REQUEST' );

		const key = `city:${id}`;
		const previous = this.#writes.get( key ) ?? Promise.resolve();
		const pending = previous.catch( () => {} ).then( () => this.#saveCity( city ) );
		this.#writes.set( key, pending );

		try {

			return await pending;

		} finally {

			if ( this.#writes.get( key ) === pending ) this.#writes.delete( key );

		}

	}

	async saveGame( request ) {

		const id = request?.game?.id;
		if ( typeof id === 'string' && ! SAFE_ID.test( id ) ) assertSafeId( id );
		this.boundary.assert( 'save-request', request, 'E_INVALID_REQUEST', 'save request' );
		this.#assertGameSemantics( request.game, 'E_INVALID_REQUEST' );

		const key = `game:${id}`;
		const previous = this.#writes.get( key ) ?? Promise.resolve();
		const pending = previous.catch( () => {} ).then( () => this.#saveGame( request ) );
		this.#writes.set( key, pending );

		try {

			return await pending;

		} finally {

			if ( this.#writes.get( key ) === pending ) this.#writes.delete( key );

		}

	}

	#reference( reference, subject ) {

		if ( typeof reference?.id === 'string' && ! SAFE_ID.test( reference.id ) ) assertSafeId( reference.id );
		this.boundary.assert( 'descriptor-ref', reference, 'E_INVALID_REQUEST', `${subject} reference` );
		return reference.id;

	}

	async #loadCity( id ) {

		const city = await this.#read( 'cities', id, 'city-descriptor', 'city' );
		this.#assertCitySemantics( city );
		return city;

	}

	async #loadGame( id ) {

		const game = await this.#read( 'games', id, 'game-descriptor', 'game' );
		this.#assertGameSemantics( game, 'E_INVALID_DESCRIPTOR' );
		const city = await this.#referencedCity( game.cityId );
		assertGameMatchesCity( game, city, 'E_INVALID_DESCRIPTOR' );
		return game;

	}

	async #read( kind, id, schema, subject ) {

		const text = await this.store.readDescriptor( kind, id );
		let value;
		try {

			value = JSON.parse( text );

		} catch ( error ) {

			throw new LibraryError( 'E_INVALID_DESCRIPTOR', `${subject} ${id} is not valid JSON`, [ error.message ] );

		}

		this.boundary.assert( schema, value, 'E_INVALID_DESCRIPTOR', `${subject} ${id}` );
		if ( value.id !== id ) {

			throw new LibraryError( 'E_INVALID_DESCRIPTOR', `${subject} ${id} declares id ${value.id}` );

		}
		return value;

	}

	async #referencedCity( id ) {

		try {

			return await this.#loadCity( id );

		} catch ( error ) {

			if ( error instanceof LibraryError && error.code === 'E_CITY_NOT_FOUND' ) {

				throw new LibraryError( 'E_REFERENCE_NOT_FOUND', `referenced city ${id} was not found` );

			}
			throw error;

		}

	}

	async #saveGame( request ) {

		const { game, expectedRevision } = request;
		const city = await this.#referencedCity( game.cityId );
		assertGameMatchesCity( game, city, 'E_INVALID_REQUEST' );

		const exists = await this.store.hasDescriptor( 'games', game.id );
		let current = null;
		if ( exists ) current = await this.#loadGame( game.id );
		assertRevision( game, current, expectedRevision );
		if ( current ) assertImmutableSaveFields( game, current );

		const saved = canonicalClone( game );
		await this.store.writeGame( game.id, canonicalJson( saved ) );
		const result = { contractVersion: VERSION, created: ! exists, game: saved };
		this.boundary.assert( 'save-result', result, 'E_INVALID_DESCRIPTOR', 'save result' );
		return result;

	}

	async #saveCity( city ) {

		if ( await this.store.hasDescriptor( 'cities', city.id ) ) {

			throw new LibraryError( 'E_EXISTS', `city ${city.id} already exists` );

		}
		const saved = canonicalClone( city );
		await this.store.writeCity( city.id, canonicalJson( saved ) );
		const result = { contractVersion: VERSION, created: true, city: saved };
		this.boundary.assert( 'city-save-result', result, 'E_INVALID_DESCRIPTOR', 'city save result' );
		return result;

	}

	#assertCitySemantics( city, code = 'E_INVALID_DESCRIPTOR' ) {

		assertTimestamp( city.generatedAt, `city ${city.id} generatedAt`, code );
		assertUniqueIds( city.buildings, `city ${city.id} buildings`, code );
		for ( const resource of Object.values( city.world ) ) assertSafeResource( resource.uri );

	}

	#assertGameSemantics( game, code ) {

		assertTimestamp( game.save.createdAt, `game ${game.id} save.createdAt`, code );
		const created = Date.parse( game.save.createdAt );
		const updated = assertTimestamp( game.save.updatedAt, `game ${game.id} save.updatedAt`, code );
		if ( updated < created ) throw new LibraryError( code, `game ${game.id} was updated before it was created` );
		if ( game.questBundle ) assertSafeResource( game.questBundle.uri );
		assertUniqueIds( game.quests, `game ${game.id} quests`, code );
		assertUniqueIds( game.sideJobs, `game ${game.id} sideJobs`, code );
		assertUniqueIds( game.player.inventory, `game ${game.id} inventory`, code );
		assertUniqueIds( game.discoveredLocations, `game ${game.id} discovered locations`, code );

		const questIds = new Set( game.quests.map( ( quest ) => quest.id ) );
		for ( const sideJob of game.sideJobs ) if ( questIds.has( sideJob.id ) ) {

			throw new LibraryError( code, `game ${game.id} repeats ${sideJob.id} as a quest and side job` );

		}

	}

}

function assertSafeId( id ) {

	if ( SAFE_ID.test( id ) ) return;
	throw new LibraryError( 'E_INVALID_ID', `library id is unsafe: ${String( id )}` );

}

function assertSafeResource( uri ) {

	if ( uri.includes( '\\' ) || uri.startsWith( '/' ) ) {

		throw new LibraryError( 'E_UNSAFE_PATH', `resource URI must stay inside its descriptor directory: ${uri}` );

	}
	const parts = uri.split( '/' );
	if ( parts.some( ( part ) => ! part || part === '.' || part === '..' || ! SAFE_RESOURCE_PART.test( part ) ) ) {

		throw new LibraryError( 'E_UNSAFE_PATH', `resource URI must stay inside its descriptor directory: ${uri}` );

	}

}

function assertTimestamp( value, subject, code ) {

	const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec( value );
	const timestamp = Date.parse( value );
	const date = new Date( timestamp );
	if ( ! parts || ! Number.isFinite( timestamp ) ||
		date.getUTCFullYear() !== Number( parts[ 1 ] ) ||
		date.getUTCMonth() + 1 !== Number( parts[ 2 ] ) ||
		date.getUTCDate() !== Number( parts[ 3 ] ) ||
		date.getUTCHours() !== Number( parts[ 4 ] ) ||
		date.getUTCMinutes() !== Number( parts[ 5 ] ) ||
		date.getUTCSeconds() !== Number( parts[ 6 ] ) ) {

		throw new LibraryError( code, `${subject} is not a real UTC timestamp` );

	}
	return timestamp;

}

function assertUniqueIds( values, subject, code ) {

	const ids = values.map( ( value ) => value.id );
	if ( new Set( ids ).size !== ids.length ) throw new LibraryError( code, `${subject} contains duplicate ids` );

}

function assertGameMatchesCity( game, city, code ) {

	if ( game.size !== city.size ) {

		throw new LibraryError( code, `game ${game.id} size does not match city ${city.id}` );

	}
	const available = new Set( city.buildings.filter( ( building ) => building.eligible ).map( ( building ) => building.id ) );
	for ( const id of game.selectedInteriors ) if ( ! available.has( id ) ) {

		throw new LibraryError( code, `game ${game.id} selects unknown interior ${id}` );

	}

}

function assertRevision( game, current, expected ) {

	if ( current === null ) {

		if ( expected !== null || game.save.revision !== 1 ) {

			throw new LibraryError( 'E_REVISION_CONFLICT', `new game ${game.id} must expect null and start at revision 1` );

		}
		return;

	}

	const revision = current.save.revision;
	if ( expected !== revision || game.save.revision !== revision + 1 ) {

		throw new LibraryError( 'E_REVISION_CONFLICT', `game ${game.id} is at revision ${revision}` );

	}

}

function assertImmutableSaveFields( game, current ) {

	if ( game.cityId !== current.cityId ) throw new LibraryError( 'E_INVALID_REQUEST', `game ${game.id} cannot change city` );
	if ( game.size !== current.size ) throw new LibraryError( 'E_INVALID_REQUEST', `game ${game.id} cannot change size` );
	if ( JSON.stringify( game.selectedInteriors ) !== JSON.stringify( current.selectedInteriors ) ) {

		throw new LibraryError( 'E_INVALID_REQUEST', `game ${game.id} cannot change selected interiors` );

	}
	if ( JSON.stringify( game.questBundle ) !== JSON.stringify( current.questBundle ) ) {

		throw new LibraryError( 'E_INVALID_REQUEST', `game ${game.id} cannot change its quest bundle` );

	}
	if ( game.save.createdAt !== current.save.createdAt ) throw new LibraryError( 'E_INVALID_REQUEST', `game ${game.id} cannot change save.createdAt` );
	if ( Date.parse( game.save.updatedAt ) < Date.parse( current.save.updatedAt ) ) {

		throw new LibraryError( 'E_INVALID_REQUEST', `game ${game.id} cannot move save.updatedAt backwards` );

	}

}
