import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorldSource } from './WorldSource.js';
import { packPlanBlueprint } from '../../assembly/kit/PlanBlueprint.js';

vi.mock( '../../assembly/connectionsRunner.js', () => ( {
	runConnections: vi.fn( async () => ( { networks: { walk: {}, drive: {} } } ) )
} ) );

const modules = { version: 1, grid: 0.5, modules: [] };
const kitDocument = { seed: 'kit', families: [] };

function moduleHash() {

	return documentHash( modules );

}

function documentHash( document ) {

	return createHash( 'sha256' ).update( JSON.stringify( document ) ).digest( 'hex' );

}

const atlas = {
	meta: { seed: 'city', version: '0.14.0' },
	parcels: [ { id: 'p0' }, { id: 'p1' } ]
};
const manifest = {
	contractVersion: '1.0.0', seed: 'city', atlasVersion: '0.14.0', named: false, namingTheme: null,
	parcels: [ 'p0', 'p1' ], interiors: [ 'p1' ],
	interiorModules: { file: 'interior-modules/modules.json', sha256: moduleHash() }
};

/** What Interior publishes per furnished parcel: a manifest and the layouts it names. */
const interior = {
	building: {
		version: 1, buildingId: 'p1', modules: 'modules.json', props: 'catalog.json',
		layouts: { ground: 'layouts/ground.json', middle: 'layouts/middle.json', crown: 'layouts/crown.json' },
		floors: [ { index: 0, layout: 'ground', elevation: 0, openings: {} } ], connectors: []
	},
	layouts: { ground: { id: 'ground' }, middle: { id: 'middle' }, crown: { id: 'crown' } }
};

describe( 'WorldSource selective interiors', () => {

	afterEach( () => vi.unstubAllGlobals() );

	it( 'loads every exterior shell but reads interior files only for listed parcels', async () => {

		const documents = new Map( [
			[ '/out/city/blueprint.json', atlas ],
			[ '/out/city/manifest.json', manifest ],
			[ '/out/city/interior-modules/modules.json', modules ],
			[ '/out/city/p0/p0.blueprint.json', { buildingId: 'p0' } ],
			[ '/out/city/p1/p1.blueprint.json', { buildingId: 'p1' } ],
			[ '/out/city/p1/interior/npc.json', { buildingId: 'p1' } ],
			[ '/out/city/p1/interior/building.json', interior.building ],
			[ '/out/city/p1/interior/layouts/ground.json', interior.layouts.ground ],
			[ '/out/city/p1/interior/layouts/middle.json', interior.layouts.middle ],
			[ '/out/city/p1/interior/layouts/crown.json', interior.layouts.crown ]
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
		expect( world.buildings.get( 'p0' ) ).toMatchObject( { hasInterior: false, npc: null, interior: null } );
		expect( world.buildings.get( 'p1' ) ).toMatchObject( { hasInterior: true, npc: { buildingId: 'p1' }, interior } );
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
			[ '/out/games/night-shift/manifest.json', { ...manifest, parcels: [], interiors: [], interiorModules: undefined } ],
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
		expect( world.game ).toEqual( game );
		expect( fetch ).toHaveBeenCalledWith( '/out/games/night-shift/game.json' );

		game.questBundle = null;
		vi.mocked( fetch ).mockClear();
		const freePlay = await new WorldSource( {
			blueprintUrl: '/atlas/city.json', outBase: '/out/games/night-shift', gameId: 'night-shift'
		} ).load();
		expect( freePlay ).toMatchObject( { questBundle: null, questlines: [], investigations: [] } );
		expect( fetch.mock.calls.some( ( [ url ] ) => url.includes( '/quests/' ) ) ).toBe( false );

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
			mechanicTargetBindings: [],
			missionAssetRequests: [ { assetId: 'quest.ledger' } ],
			missionItemBindings: [ { questId: 'q-main', itemId: 'ledger', assetId: 'quest.ledger' } ],
			hostCapabilities: { transportationModes: [] }
		};
		const bundle = {
			contractVersion: '1.1',
			files: {
				questlines: 'questlines.json', objectives: 'objectives.json', investigations: 'investigations.json',
				mechanicTargetBindings: 'mechanic-target-bindings.json', missionAssetRequests: 'mission-assets.json',
				missionItemBindings: 'mission-item-bindings.json', hostCapabilities: 'host-capabilities.json'
			},
			counts: Object.fromEntries( Object.entries( catalogs )
				.filter( ( [ name ] ) => name !== 'hostCapabilities' )
				.map( ( [ name, values ] ) => [ name, values.length ] ) )
		};
		const documents = new Map( [
			[ '/out/games/quest/blueprint.json', atlas ],
			[ '/out/games/quest/manifest.json', { ...manifest, parcels: [], interiors: [], interiorModules: undefined } ],
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
		expect( world.questBundle.manifest ).toEqual( bundle );
		expect( world.objectives ).toEqual( catalogs.objectives );
		expect( world.missionAssetRequests ).toEqual( catalogs.missionAssetRequests );
		expect( world.missionItemBindings ).toEqual( catalogs.missionItemBindings );
		expect( world.hostCapabilities ).toEqual( catalogs.hostCapabilities );

		documents.set( '/out/games/quest/quests/quest-bundle.json', {
			...bundle, counts: { ...bundle.counts, objectives: 2 }
		} );
		await expect( source.load() ).rejects.toThrow( 'objectives.json has 1 records, expected 2' );

	} );

	it( 'composes a kit parcel blueprint from its plan, reading that plan once for the city', async () => {

		const square = [ [ 0, 0 ], [ 8, 0 ], [ 8, 8 ], [ 0, 8 ] ];
		const plan = packPlanBlueprint( {
			buildingId: 'tower', version: '1', seed: 'kit',
			bounds: { footprint: square, height: 4 },
			floors: [ {
				index: 0, kind: 'residential', elevation: 0, height: 4, outline: square,
				openings: [ { id: 'place:0/window:0', kind: 'window', edge: 0, offset: 2, sill: 1, width: 2, height: 2 } ],
				roomEnvelope: {
					corners: [ [ 1, 1 ], [ 7, 1 ], [ 7, 7 ], [ 1, 7 ] ], origin: [ 1, 1 ], axisU: [ 1, 0 ], axisV: [ 0, 1 ],
					width: 6, depth: 6, grid: { origin: [ 0, 0 ], angle: 0, spacing: 0.5 }, vertical: { min: 0, max: 3 }
				}
			} ],
			balconyBands: [], anchors: [], signage: [], screens: [], lights: [],
			facade: { exteriorStyle: 'premium-mineral', grids: [ { floor: 0, edge: 0, length: 8 } ] },
			facadeArtifacts: [], fireEscape: null, facadeServices: { version: 1 },
			roof: { elevation: 4, outline: square, parapetHeight: 0, bulkhead: null, artifacts: [] },
			materials: [], materialVariants: {}
		} );
		const record = ( parcel, origin ) => ( {
			parcel, plan: 'tower', origin, rotationY: Math.PI / 2, face: 1, lot: square,
			bounds: { min: [ 0, 0, 0 ], max: [ 8, 4, 8 ] }, signText: null, family: 'white-grid', floors: 1,
			floorKinds: [ 'lobby' ], exteriorStyle: 'premium-office', tint: parcel
		} );
		const documents = new Map( [
			[ '/out/city/blueprint.json', atlas ],
			[ '/out/city/manifest.json', {
				...manifest, interiors: [], interiorModules: undefined,
				kit: { file: 'kit.json', sha256: documentHash( kitDocument ), shared: 'kit/0123456789abcdef' },
				sources: { p0: 'kit', p1: 'kit' },
				buildings: {
					p0: { template: null, slot: null, plan: 'tower', blueprint: 'plan' },
					p1: { template: null, slot: null, plan: 'tower', blueprint: 'plan' }
				}
			} ],
			[ '/out/shared/kit/0123456789abcdef/kit.json', kitDocument ],
			[ '/out/city/kit/plans/tower.blueprint.json', plan ],
			[ '/out/city/p0/p0.placements.json', record( 'p0', [ 100, 0, 200 ] ) ],
			[ '/out/city/p1/p1.placements.json', record( 'p1', [ 300, 0, 400 ] ) ]
		] );
		const requested = [];
		vi.stubGlobal( 'fetch', vi.fn( async ( url ) => {

			requested.push( url );
			if ( optional( url ) ) return response( 404, null );
			if ( ! documents.has( url ) ) throw new Error( `unexpected ${url}` );
			return response( 200, documents.get( url ) );

		} ) );

		const world = await new WorldSource( { blueprintUrl: '/atlas/city.json', outBase: '/out/city' } ).load();
		const p0 = world.buildings.get( 'p0' ).blueprint;
		const floor = p0.floors[ 0 ];

		// Its own building id and its own use, and every point in the world frame.
		expect( p0.buildingId ).toBe( 'p0' );
		expect( floor.kind ).toBe( 'lobby' );
		expect( p0.facade.exteriorStyle ).toBe( 'premium-office' );
		// A quarter turn about the lot corner the entrance runs from: the plan's
		// own first corner lands on lot face 1, and its openings with it.
		expect( floor.outline ).toEqual( [ [ 108, 200 ], [ 100, 200 ], [ 100, 192 ], [ 108, 192 ] ] );
		expect( floor.openings[ 0 ].edge ).toBe( 1 );
		expect( world.buildings.get( 'p1' ).blueprint.floors[ 0 ].outline[ 1 ] ).toEqual( [ 300, 400 ] );

		// No parcel carries a blueprint of its own, and the plan is read once.
		expect( requested.filter( ( url ) => url.endsWith( 'tower.blueprint.json' ) ) ).toHaveLength( 1 );
		expect( requested.some( ( url ) => /p\d\.blueprint\.json$/.test( url ) ) ).toBe( false );

	} );

	it( 'reads a kit parcel that carries a blueprint of its own from that file', async () => {

		// A world assembled before the document moved to the plan: its manifest
		// names no blueprint source, and every parcel holds its own.
		const documents = new Map( [
			[ '/out/city/blueprint.json', atlas ],
			[ '/out/city/manifest.json', {
				...manifest, interiors: [], interiorModules: undefined,
				kit: { file: 'kit.json', sha256: documentHash( kitDocument ), shared: 'kit/0123456789abcdef' },
				sources: { p0: 'kit', p1: 'kit' },
				buildings: {
					p0: { template: null, slot: null, plan: 'tower' },
					p1: { template: null, slot: null, plan: 'tower' }
				}
			} ],
			[ '/out/shared/kit/0123456789abcdef/kit.json', kitDocument ],
			[ '/out/city/p0/p0.blueprint.json', { buildingId: 'p0' } ],
			[ '/out/city/p1/p1.blueprint.json', { buildingId: 'p1' } ]
		] );
		const requested = [];
		vi.stubGlobal( 'fetch', vi.fn( async ( url ) => {

			requested.push( url );
			if ( optional( url ) ) return response( 404, null );
			if ( ! documents.has( url ) ) throw new Error( `unexpected ${url}` );
			return response( 200, documents.get( url ) );

		} ) );

		const world = await new WorldSource( { blueprintUrl: '/atlas/city.json', outBase: '/out/city' } ).load();

		expect( world.buildings.get( 'p0' ) ).toMatchObject( { source: 'kit', blueprint: { buildingId: 'p0' } } );
		expect( requested.some( ( url ) => url.includes( '/kit/plans/' ) ) ).toBe( false );

	} );

} );

function optional( url ) {

	return url.endsWith( '/npc-types.json' )
		|| url.endsWith( '/quests/quest-bundle.json' )
		|| url.endsWith( '/quests/questlines.json' )
		|| url.endsWith( '/quests/investigations.json' );

}

function response( status, body, type = 'application/json' ) {

	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: () => type },
		json: async () => body,
		arrayBuffer: async () => new TextEncoder().encode( JSON.stringify( body ) ).buffer
	};

}
