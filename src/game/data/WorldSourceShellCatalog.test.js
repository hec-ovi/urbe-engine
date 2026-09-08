import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { writeWorldArchive } from '../../world-archive/index.js';
import { WorldSource } from './WorldSource.js';

let directory;
afterEach( async () => {

	vi.unstubAllGlobals();
	if ( directory ) await rm( directory, { recursive: true, force: true } );
	directory = undefined;

} );

it( 'loads nearby authored bounds and every interior, then admits explicit distant IDs with eight document requests at once', async () => {

	const fixture = await serve();
	const world = await fixture.source.load();
	const initialIds = [ 'p0', 'p1', 'p2', ...fixture.manifest.interiors ];
	expect( [ ...world.buildings.keys() ] ).toEqual( initialIds );
	expect( world.shellCatalog ).toEqual( fixture.catalog );
	expect( world.unbuilt ).toEqual( [ 'unassembled' ] );
	for ( const id of fixture.manifest.interiors ) {

		expect( world.buildings.get( id ) ).toMatchObject( {
			hasInterior: true, npc: { buildingId: id },
			floors: [ { floor: 0, glbUrl: `/out/catalog/${id}/interior/floors/000.glb` }, { floor: 1, glbUrl: `/out/catalog/${id}/interior/floors/001.glb` } ]
		} );

	}
	expect( fixture.requested.some( path => path.includes( '/p3/' ) ) ).toBe( false );
	expect( fixture.requested.some( path => path.includes( '/p250/' ) ) ).toBe( false );
	const firstIds = Array.from( { length: 16 }, ( _, i ) => `p${i + 3}` );
	const secondIds = Array.from( { length: 16 }, ( _, i ) => `p${i + 250}` );
	const [ first, second ] = await Promise.all( [ world.loadBuildings( firstIds ), world.loadBuildings( secondIds ) ] );
	expect( [ ...first.keys() ] ).toEqual( firstIds );
	expect( [ ...second.keys() ] ).toEqual( secondIds );
	expect( first.get( 'p3' ) ).toMatchObject( { parcelId: 'p3', blueprint: { buildingId: 'p3' }, hasInterior: false, npc: null, floors: [] } );
	expect( fixture.requested ).toContain( '/out/catalog/p3/p3.blueprint.json' );
	expect( [ ...world.buildings.keys() ] ).toEqual( initialIds );
	expect( fixture.peak() ).toBe( 8 );
	const before = fixture.requested.length;
	await expect( world.loadBuildings( [ 'p19', 'unassembled' ] ) ).rejects.toThrow( 'E_WORLD_BUILDINGS' );
	await expect( world.loadBuildings( [ 'p19', 'p19' ] ) ).rejects.toThrow( 'unique' );
	expect( fixture.requested.length ).toBe( before );
	expect( await world.loadBuildings( [] ) ).toEqual( new Map() );

} );

it( 'keeps every shell resident for a small catalog even when its bounds are distant', async () => {

	const fixture = await serve( { count: 20 } );
	const world = await fixture.source.load();
	expect( [ ...world.buildings.keys() ] ).toEqual( fixture.manifest.parcels );
	expect( fixture.requested ).toContain( '/out/catalog/p19/p19.blueprint.json' );

} );

it( 'uses the first selected interior center for a large city preview', async () => {

	const fixture = await serve( { game: false } );
	const world = await fixture.source.load();
	expect( world.buildings.has( 'p300' ) ).toBe( true );
	expect( world.buildings.has( 'p299' ) ).toBe( true );
	expect( world.buildings.has( 'p0' ) ).toBe( false );
	expect( fixture.requested.some( path => path.endsWith( '/game.json' ) ) ).toBe( false );

} );

it( 'uses catalog bounds midpoint for a preview without interiors', async () => {

	const fixture = await serve( { game: false, interiors: false } );
	const world = await fixture.source.load();
	expect( world.buildings.has( 'p110' ) ).toBe( true );
	expect( world.buildings.has( 'p0' ) ).toBe( false );
	expect( world.buildings.has( 'p319' ) ).toBe( false );

} );

it.each( [
	[ 'foreign seed', catalog => { catalog.seed = 'foreign'; }, 'seed' ],
	[ 'duplicate ID', catalog => { catalog.buildings[ 1 ].id = 'p0'; }, 'IDs' ],
	[ 'unknown ID', catalog => { catalog.buildings[ 1 ].id = 'foreign'; }, 'IDs' ],
	[ 'nonpositive bounds', catalog => { catalog.buildings[ 0 ].bounds.max[ 0 ] = 0; }, 'positive extent' ],
	[ 'missing material', catalog => { delete catalog.buildings[ 0 ].bands[ 0 ].material; }, 'material' ]
] )( 'rejects a catalog with %s before loading any full building', async ( _label, change, message ) => {

	const fixture = await serve( { change } );
	await expect( fixture.source.load() ).rejects.toThrow( message );
	expect( fixture.requested.some( path => /\/p\d+\//.test( path ) ) ).toBe( false );

} );

it( 'rejects a modified shell catalog index before its parts or building documents load', async () => {

	const fixture = await serve();
	const file = join( directory, 'index.json' );
	await writeFile( file, Buffer.concat( [ await readFile( file ), Buffer.from( ' ' ) ] ) );
	await expect( fixture.source.load() ).rejects.toThrow( /E_WORLD_SHELL_CATALOG:.*byte hash mismatch/ );
	expect( fixture.requested.some( path => path.includes( '/shells/parts/' ) || /\/p\d+\//.test( path ) ) ).toBe( false );

} );

async function serve( { count = 320, game = true, interiors = true, change = () => {} } = {} ) {

	directory = await mkdtemp( join( tmpdir(), 'urbe-source-shells-' ) );
	const catalog = { version: '1.0.0', seed: 'catalog', buildings: Array.from( { length: count }, ( _, index ) => building( index ) ) };
	const ids = catalog.buildings.map( entry => entry.id );
	const inside = interiors ? ids.slice( - 20 ) : [];
	const atlas = { meta: { seed: 'catalog', version: '0.21.0' }, parcels: [ ...ids, 'unassembled' ].map( id => ( { id } ) ) };
	const connections = {
		meta: { seed: 'catalog', atlasSeed: 'catalog', version: '0.9.0' }, links: [], apertures: [], linkRefs: [], layers: [],
		networks: { walk: { nodes: [], edges: [] }, road: { lanes: [] }, signals: [], transit: { routes: [] }, air: { corridors: [] } }
	};
	change( catalog );
	await writeWorldArchive( catalog, directory, { maxRecords: 50 } );
	const json = value => JSON.stringify( value );
	const hash = value => createHash( 'sha256' ).update( value ).digest( 'hex' );
	const manifest = {
		contractVersion: '1.0.0', seed: 'catalog', atlasVersion: '0.21.0', named: false, namingTheme: null,
		parcels: ids, interiors: inside, floors: Object.fromEntries( inside.map( id => [ id, [ '000', '001' ] ] ) ),
		connections: { file: 'connections.json', sha256: hash( json( connections ) ), blueprintSha256: hash( json( atlas ) ) },
		shellCatalog: { file: 'shells/index.json', encoding: 'archive', sha256: hash( await readFile( join( directory, 'index.json' ) ) ) }
	};
	const documents = new Map( [
		[ '/out/catalog/manifest.json', manifest ], [ '/out/catalog/blueprint.json', atlas ], [ '/out/catalog/connections.json', connections ],
		[ '/out/catalog/game.json', { id: 'catalog', questBundle: null, player: { position: { x: 0, y: 0.2, z: 0 } } } ],
		...ids.map( id => [ `/out/catalog/${id}/${id}.blueprint.json`, { buildingId: id } ] ),
		...inside.flatMap( id => [
			[ `/out/catalog/${id}/interior/npc.json`, { buildingId: id } ],
			[ `/out/catalog/${id}/interior/floors/000.json`, { floor: 0 } ], [ `/out/catalog/${id}/interior/floors/001.json`, { floor: 1 } ]
		] )
	] );
	const requested = [];
	let active = 0, maximum = 0;
	vi.stubGlobal( 'fetch', vi.fn( async url => {

		const path = String( url ).replace( /^https?:\/\/[^/]+/, '' );
		requested.push( path );
		const fullBuilding = /\/p\d+\//.test( path );
		if ( fullBuilding ) {

			active ++; maximum = Math.max( maximum, active );
			await new Promise( resolve => setTimeout( resolve, 0 ) );

		}
		try {

			const bytes = path.startsWith( '/out/catalog/shells/' )
				? await readFile( join( directory, path.slice( '/out/catalog/shells/'.length ) ) )
				: documents.has( path ) ? json( documents.get( path ) ) : null;
			return new Response( bytes, { status: bytes === null ? 404 : 200, headers: { 'content-type': 'application/json' } } );

		} finally { if ( fullBuilding ) active --; }

	} ) );
	return {
		source: new WorldSource( { outBase: '/out/catalog', gameId: game ? 'catalog' : null } ),
		catalog, manifest, requested, peak: () => maximum
	};

}

function building( index ) {

	const minX = [ 0, 249, 250 ][ index ] ?? 1000 + index * 10;
	const maxX = index === 1 ? 600 : minX + 10;
	const outline = [ [ minX, 0 ], [ maxX, 0 ], [ maxX, 10 ], [ minX, 10 ] ];
	const material = { key: 'cyberpunk/concrete-monolith/mid', variantId: 'native-cast' };
	return {
		id: `p${index}`, bounds: { min: [ minX, 0, 0 ], max: [ maxX, 12, 10 ] }, center: [ ( minX + maxX ) / 2, 0, 5 ],
		floorCount: 3, basementCount: 0, bands: [ { bottom: 0, top: 11.5, outline, material } ],
		roof: { elevation: 11.5, outline, parapetHeight: 0.5, material, parapetMaterial: material }
	};

}
