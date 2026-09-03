import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorldSource } from './WorldSource.js';

vi.mock( '../../assembly/connectionsRunner.js', () => ( {
	runConnections: vi.fn( async () => ( { networks: { walk: {}, drive: {} } } ) )
} ) );

const atlas = {
	meta: { seed: 'city', version: '0.14.0' },
	parcels: [ { id: 'p0' }, { id: 'p1' } ]
};
const manifest = {
	contractVersion: '1.0.0', seed: 'city', atlasVersion: '0.14.0', named: false, namingTheme: null,
	parcels: [ 'p0', 'p1' ], interiors: [ 'p1' ], floors: { p1: [ '000' ] }
};

describe( 'WorldSource selective interiors', () => {

	afterEach( () => vi.unstubAllGlobals() );

	it( 'loads every exterior shell but reads interior files only for listed parcels', async () => {

		const documents = new Map( [
			[ '/out/city/blueprint.json', atlas ],
			[ '/out/city/manifest.json', manifest ],
			[ '/out/city/p0/p0.blueprint.json', { buildingId: 'p0' } ],
			[ '/out/city/p1/p1.blueprint.json', { buildingId: 'p1' } ],
			[ '/out/city/p1/interior/npc.json', { buildingId: 'p1' } ],
			[ '/out/city/p1/interior/floors/000.json', { floor: 0 } ]
		] );
		const requested = [];
		vi.stubGlobal( 'fetch', vi.fn( async ( url ) => {

			requested.push( url );
			if ( optional( url ) ) return response( 404, null );
			if ( ! documents.has( url ) ) throw new Error( `unexpected ${url}` );
			return response( 200, documents.get( url ) );

		} ) );

		const world = await new WorldSource( { blueprintUrl: '/atlas/city.json', outBase: '/out/city' } ).load();

		expect( [ ...world.buildings.keys() ] ).toEqual( [ 'p0', 'p1' ] );
		expect( world.buildings.get( 'p0' ) ).toMatchObject( { hasInterior: false, npc: null, floors: [] } );
		expect( world.buildings.get( 'p1' ) ).toMatchObject( {
			hasInterior: true, npc: { buildingId: 'p1' }, floors: [ { floor: 0, glbUrl: '/out/city/p1/interior/floors/000.glb' } ]
		} );
		expect( requested.some( ( url ) => url.includes( '/p0/interior/' ) ) ).toBe( false );
		expect( world.unbuilt ).toEqual( [] );

	} );

	it( 'rejects an interior that has no listed shell', async () => {

		vi.stubGlobal( 'fetch', vi.fn( async ( url ) => response( 200,
			url.endsWith( 'blueprint.json' ) ? atlas : { ...manifest, parcels: [ 'p0' ] }
		) ) );

		await expect( new WorldSource( { blueprintUrl: '/atlas/city.json', outBase: '/out/city' } ).load() )
			.rejects.toThrow( 'interior p1 has no shell parcel' );

	} );

	it( 'loads a catalog game descriptor beside its generated world only when requested', async () => {

		const game = { id: 'night-shift', player: { position: { x: 1, y: 2, z: 3 } } };
		const documents = new Map( [
			[ '/out/games/night-shift/blueprint.json', atlas ],
			[ '/out/games/night-shift/manifest.json', { ...manifest, parcels: [], interiors: [], floors: {} } ],
			[ '/out/games/night-shift/game.json', game ]
		] );
		vi.stubGlobal( 'fetch', vi.fn( async ( url ) => {

			if ( optional( url ) ) return response( 404, null );
			if ( ! documents.has( url ) ) throw new Error( `unexpected ${url}` );
			return response( 200, documents.get( url ) );

		} ) );

		const world = await new WorldSource( {
			blueprintUrl: '/atlas/city.json', outBase: '/out/games/night-shift', gameId: 'night-shift'
		} ).load();
		expect( world.game ).toBe( game );
		expect( fetch ).toHaveBeenCalledWith( '/out/games/night-shift/game.json' );

	} );

	it( 'loads authored investigations but does not hide malformed scene content', async () => {

		const documents = new Map( [
			[ '/out/city/blueprint.json', atlas ],
			[ '/out/city/manifest.json', { ...manifest, parcels: [], interiors: [], floors: {} } ],
			[ '/out/city/quests/investigations.json', [ { sceneId: 'scene-one' } ] ]
		] );
		vi.stubGlobal( 'fetch', vi.fn( async ( url ) => {

			if ( optional( url, false ) ) return response( 404, null );
			if ( ! documents.has( url ) ) throw new Error( `unexpected ${url}` );
			return response( 200, documents.get( url ) );

		} ) );
		const world = await new WorldSource( { blueprintUrl: '/atlas/city.json', outBase: '/out/city' } ).load();
		expect( world.investigations ).toEqual( [ { sceneId: 'scene-one' } ] );

		documents.set( '/out/city/quests/investigations.json', Symbol( 'invalid json' ) );
		vi.mocked( fetch ).mockImplementation( async ( url ) => {

			if ( optional( url, false ) ) return response( 404, null );
			if ( url.endsWith( '/quests/investigations.json' ) ) return { ...response( 200, null ), json: async () => { throw new Error( 'bad' ); } };
			return response( 200, documents.get( url ) );

		} );
		await expect( new WorldSource( { blueprintUrl: '/atlas/city.json', outBase: '/out/city' } ).load() )
			.rejects.toThrow( 'investigations.json: invalid JSON' );

	} );

	it( 'loads and cross-validates every catalog named by a game quest bundle', async () => {

		const questlines = [ {
			id: 'q-main', items: [ { itemId: 'ledger' } ],
			steps: [ { stepId: 'take-ledger', target: { kind: 'pickup', itemId: 'ledger' } } ]
		} ];
		const catalogs = {
			questlines,
			objectives: [ { questId: 'q-main', stepId: 'take-ledger', action: questlines[ 0 ].steps[ 0 ].target } ],
			investigations: [],
			missionAssetRequests: [ { assetId: 'quest.ledger' } ],
			missionItemBindings: [ { questId: 'q-main', itemId: 'ledger', assetId: 'quest.ledger' } ]
		};
		const bundle = {
			contractVersion: '1.0',
			files: {
				questlines: 'questlines.json', objectives: 'objectives.json', investigations: 'investigations.json',
				missionAssetRequests: 'mission-assets.json', missionItemBindings: 'mission-item-bindings.json'
			},
			counts: Object.fromEntries( Object.entries( catalogs ).map( ( [ name, values ] ) => [ name, values.length ] ) )
		};
		const documents = new Map( [
			[ '/out/games/quest/blueprint.json', atlas ],
			[ '/out/games/quest/manifest.json', { ...manifest, parcels: [], interiors: [], floors: {} } ],
			[ '/out/games/quest/game.json', { id: 'quest', questBundle: { uri: 'quests/quest-bundle.json' } } ],
			[ '/out/games/quest/quests/quest-bundle.json', bundle ],
			...Object.entries( bundle.files ).map( ( [ name, file ] ) => [ `/out/games/quest/quests/${file}`, catalogs[ name ] ] )
		] );
		vi.stubGlobal( 'fetch', vi.fn( async ( url ) => {

			if ( url.endsWith( '/npc-types.json' ) ) return response( 404, null );
			if ( ! documents.has( url ) ) throw new Error( `unexpected ${url}` );
			return response( 200, documents.get( url ) );

		} ) );

		const source = new WorldSource( {
			blueprintUrl: '/atlas/city.json', outBase: '/out/games/quest', gameId: 'quest'
		} );
		const world = await source.load();
		expect( world.questBundle.manifest ).toBe( bundle );
		expect( world.objectives ).toEqual( catalogs.objectives );
		expect( world.missionAssetRequests ).toEqual( catalogs.missionAssetRequests );
		expect( world.missionItemBindings ).toEqual( catalogs.missionItemBindings );

		documents.set( '/out/games/quest/quests/quest-bundle.json', {
			...bundle, counts: { ...bundle.counts, objectives: 2 }
		} );
		await expect( source.load() ).rejects.toThrow( 'objectives.json has 1 records, expected 2' );

	} );

} );

function optional( url, includeInvestigations = true ) {

	return url.endsWith( '/npc-types.json' )
		|| url.endsWith( '/quests/quest-bundle.json' )
		|| url.endsWith( '/quests/questlines.json' )
		|| includeInvestigations && url.endsWith( '/quests/investigations.json' );

}

function response( status, body ) {

	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: () => 'application/json' },
		json: async () => body
	};

}
