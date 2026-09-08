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

it( 'loads source-bound archived world collections without optional proofs and refuses a corrupted part', async () => {

	const atlas = blueprint();
	const fixture = await serve( atlas );
	const world = await fixture.source.load();
	expect( world.atlas ).toEqual( atlas );
	expect( world.connections ).toEqual( fixture.connections );
	expect( fixture.requested.filter( path => path === '/out/archive/blueprint/index.json' ) ).toHaveLength( 1 );
	const part = fixture.requested.find( path => path.includes( '/blueprint/parts/' ) );
	expect( part ).toBeTruthy();
	const file = join( directory, part.slice( '/out/archive/'.length ) );
	await writeFile( file, Buffer.concat( [ await readFile( file ), Buffer.from( ' ' ) ] ) );
	await expect( fixture.source.load() ).rejects.toThrow( /hash|byte|size/i );

} );

it( 'retains physical geometry and skips every part of optional construction proofs', async () => {

	const atlas = blueprint();
	const polygon = [ [ 0, 0 ], [ 4, 0 ], [ 4, 8 ], [ 0, 8 ] ];
	atlas.streets.construction = {
		planningReservations: {
			version: '1.0.0',
			model: {
				id: 'atlas-directed-corridors', version: '1.0.0', authority: 'edge-local-planning', units: 'metres',
				coordinateGrid: 0.001, maximumFanStepRadians: Math.PI / 12,
				bandOrder: [ 'curb', 'walking', 'furnishing', 'frontage' ], radialOrigin: 'centerline',
				joins: 'shared-shortest-angle-fans', stations: 'equal-per-turn', caps: 'quarter-fans-per-side',
				bandOperation: 'outer-union-minus-inner-union', highwayRoadway: 'kernel-round-buffer'
			},
			edges: Array.from( { length: 120 }, ( _, index ) => ( {
				edgeId: `e${index}`, roadway: [ polygon ],
				sides: {
					left: { sidewalk: [ polygon ], walking: [ polygon ] },
					right: { sidewalk: [ polygon ], walking: [ polygon ] }
				}
			} ) )
		}
	};
	atlas.volumetric = { ground: [ { id: 'sidewalk', kind: 'sidewalk', polygon, top: 0.15, bottom: - 0.2 } ] };
	const fixture = await serve( atlas );
	const proofCollections = fixture.blueprintIndex.collections.filter( collection =>
		collection.pointer.startsWith( '/streets/construction/planningReservations/' ) );
	const proofParts = proofCollections.flatMap( collection => collection.parts.map( part => `/out/archive/blueprint/${part.file}` ) );
	expect( proofCollections.find( collection => collection.pointer.endsWith( '/edges' ) ).count ).toBe( 120 );
	expect( proofParts.length ).toBeGreaterThan( 1 );
	const world = await fixture.source.load();
	const expected = structuredClone( atlas );
	delete expected.streets.construction.planningReservations;
	expect( world.atlas ).toEqual( expected );
	expect( world.connections ).toEqual( fixture.connections );
	expect( fixture.requested.some( path => proofParts.includes( path ) ) ).toBe( false );
	for ( const collection of fixture.blueprintIndex.collections.filter( entry => entry.pointer === '/streets/nodes' ) ) {

		for ( const part of collection.parts ) expect( fixture.requested ).toContain( `/out/archive/blueprint/${part.file}` );

	}

} );

it( 'rejects a changed Connections index before fetching its collection parts', async () => {

	const fixture = await serve( blueprint() );
	const file = join( directory, 'connections/index.json' );
	await writeFile( file, Buffer.concat( [ await readFile( file ), Buffer.from( ' ' ) ] ) );
	await expect( fixture.source.load() ).rejects.toThrow( /E_WORLD_CONNECTIONS:.*byte hash mismatch/ );
	expect( fixture.requested.some( path => path.includes( '/connections/parts/' ) ) ).toBe( false );

} );

function blueprint() {

	return {
		meta: { seed: 'archive', version: '0.21.0' }, parcels: [],
		streets: { nodes: Array.from( { length: 120 }, ( _, i ) => ( {
			id: `n${i}`, position: [ i * 2, i * 3 ], edgeIds: [], connections: []
		} ) ) }
	};

}

async function serve( atlas ) {

	directory = await mkdtemp( join( tmpdir(), 'urbe-source-archive-' ) );
	const connections = {
		meta: { seed: 'archive', atlasSeed: 'archive', version: '0.9.0' },
		links: [], apertures: [], linkRefs: [], layers: [],
		networks: {
			walk: { nodes: Array.from( { length: 120 }, ( _, i ) => ( { id: `n${i}`, x: i, y: 0, z: 0, kind: 'sidewalk' } ) ), edges: [] },
			road: { lanes: [] }, signals: [], transit: { routes: [] }, air: { corridors: [] }
		}
	};
	const blueprintIndex = await writeWorldArchive( atlas, join( directory, 'blueprint' ), { maxRecords: 10 } );
	await writeWorldArchive( connections, join( directory, 'connections' ) );
	const digest = async file => createHash( 'sha256' ).update( await readFile( join( directory, file ) ) ).digest( 'hex' );
	const blueprintHash = await digest( 'blueprint/index.json' );
	const manifest = {
		contractVersion: '1.0.0', seed: 'archive', atlasVersion: '0.21.0', named: false, namingTheme: null,
		parcels: [], interiors: [], floors: {},
		blueprint: { file: 'blueprint/index.json', encoding: 'archive', sha256: blueprintHash },
		connections: { file: 'connections/index.json', encoding: 'archive', sha256: await digest( 'connections/index.json' ), blueprintSha256: blueprintHash }
	};
	await writeFile( join( directory, 'manifest.json' ), JSON.stringify( manifest ) );
	await writeFile( join( directory, 'game.json' ), JSON.stringify( { id: 'archive', questBundle: null } ) );
	const requested = [];
	vi.stubGlobal( 'fetch', vi.fn( async url => {

		const path = String( url ).replace( /^https?:\/\/[^/]+/, '' );
		requested.push( path );
		if ( ! path.startsWith( '/out/archive/' ) ) throw new Error( `unexpected URL: ${url}` );
		try {

			return new Response( await readFile( join( directory, path.slice( '/out/archive/'.length ) ) ), {
				headers: { 'content-type': 'application/json' }
			} );

		} catch { return new Response( '', { status: 404 } ); }

	} ) );
	return { source: new WorldSource( { outBase: '/out/archive', gameId: 'archive' } ), requested, connections, blueprintIndex };

}
