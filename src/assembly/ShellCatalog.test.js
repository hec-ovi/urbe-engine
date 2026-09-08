import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openWorldArchive, readWorldArchive } from '../world-archive/index.js';
import { collectShellArtifacts } from './ShellArtifacts.js';
import { OutDir } from './OutDir.js';
import { rooftopSpanRequest } from './RooftopSpanPlan.js';
import { validateExteriorBlueprint, validateShellCatalog, validateWorldManifest } from './validators.js';
import atlas from './connections-city.fixture.json';
import blueprints from './shell-blueprints.fixture.json';

let root;
afterEach( () => { if ( root ) rmSync( root, { recursive: true, force: true } ); root = null; } );
function sources( ids ) {

	root = mkdtempSync( join( tmpdir(), 'urbe-shell-catalog-' ) );
	for ( const id of ids ) {

		mkdirSync( join( root, id ) );
		writeFileSync( join( root, id, `${id}.blueprint.json` ), JSON.stringify( blueprints[ id ] ) );
		writeFileSync( join( root, id, `${id}.glb` ), 'fixture-shell' );

	}
	return root;

}

describe( 'completed-shell streaming catalog', () => {

	it( 'projects authored storeys, setbacks, roof and concrete bindings without retaining full blueprints', async () => {

		const ids = [ 'p0', 'tower', 'p1' ];
		for ( const id of ids ) expect( validateExteriorBlueprint( blueprints[ id ] ) ).toEqual( [] );
		sources( ids );
		const podium = structuredClone( blueprints.p1 );
		podium.facade.groundMaterial = blueprints.tower.facade.materialPlan.field;
		podium.floors.unshift( { ...podium.floors[ 0 ], index: - 1, kind: 'basement', elevation: - 4, height: 4 } );
		expect( validateExteriorBlueprint( podium ) ).toEqual( [] );
		writeFileSync( join( root, 'p1/p1.blueprint.json' ), JSON.stringify( podium ) );
		const { catalog, rooftopRequest } = await collectShellArtifacts( root, ids, { seed: atlas.meta.seed } );
		expect( validateShellCatalog( catalog ) ).toEqual( [] );
		expect( catalog.buildings.map( building => building.id ) ).toEqual( ids );
		const [ ordinary, tower ] = catalog.buildings;
		expect( ordinary ).toMatchObject( { floorCount: 5, basementCount: 0, center: [ 30, 0, - 20 ], bounds: { max: [ 38.5, 18.5, - 11.5 ] } } );
		expect( ordinary.bands ).toHaveLength( 1 );
		expect( ordinary.bands[ 0 ].top ).toBe( 17.5 );
		expect( ordinary.bands[ 0 ].material ).toEqual( blueprints.p0.facade.materialPlan.field );
		expect( tower.floorCount ).toBe( 20 );
		expect( tower.bands ).toHaveLength( 3 );
		expect( tower.bands.map( band => band.outline ) ).toEqual( [ 0, 7, 15 ].map( index => blueprints.tower.floors[ index ].outline ) );
		expect( tower.bands.map( band => [ band.bottom, band.top ] ) ).toEqual( [ [ 0, 27 ], [ 27, 55 ], [ 55, 72.5 ] ] );
		expect( tower.roof ).toEqual( {
			elevation: blueprints.tower.roof.elevation, outline: blueprints.tower.roof.outline,
			parapetHeight: blueprints.tower.roof.parapetHeight,
			material: { key: 'cyberpunk/roof/rich', variantId: blueprints.tower.materialVariants[ 'cyberpunk/roof/rich' ] },
			parapetMaterial: blueprints.tower.facade.materialPlan.field
		} );
		const authoredPodium = catalog.buildings[ 2 ];
		expect( authoredPodium ).toMatchObject( { floorCount: 8, basementCount: 1 } );
		expect( authoredPodium.bands ).toHaveLength( 2 );
		expect( authoredPodium.bands[ 0 ].material ).toEqual( podium.facade.groundMaterial );
		expect( authoredPodium.bands[ 0 ].top ).toBe( blueprints.p1.floors[ 0 ].height );
		expect( authoredPodium.bands[ 1 ].material ).toEqual( podium.facade.materialPlan.field );
		expect( rooftopRequest ).toEqual( rooftopSpanRequest( atlas, ids.map( id => ( { buildingId: id, blueprint: blueprints[ id ] } ) ) ) );
		expect( JSON.stringify( { catalog, rooftopRequest } ) ).not.toMatch( /"(?:openings|facadeServices|materialVariants|blueprint)"/ );

	} );

	it.each( [ 'json', 'archive' ] )( 'publishes a checked catalog alongside %s source documents and retains full shell files', async ( encoding ) => {

		const ids = [ 'p0', 'p1' ];
		const { catalog } = await collectShellArtifacts( sources( ids ), ids, { seed: atlas.meta.seed } );
		const manifest = await new OutDir( root ).publishManifest( atlas, ids, [], { catalog, encoding, archiveOptions: { maxRecords: 1 } } );
		const indexBytes = readFileSync( join( root, 'shells/index.json' ) );
		expect( manifest.shellCatalog ).toEqual( {
			file: 'shells/index.json', encoding: 'archive', sha256: createHash( 'sha256' ).update( indexBytes ).digest( 'hex' )
		} );
		expect( validateWorldManifest( manifest ) ).toEqual( [] );
		expect( await readWorldArchive( join( root, 'shells' ) ) ).toEqual( catalog );
		const archive = await openWorldArchive( join( root, 'shells' ) );
		expect( await archive.readCollection( '/buildings', { start: 1, end: 2 } ) ).toEqual( [ catalog.buildings[ 1 ] ] );
		for ( const id of ids ) {

			expect( JSON.parse( readFileSync( join( root, id, `${id}.blueprint.json` ) ) ) ).toEqual( blueprints[ id ] );
			expect( readFileSync( join( root, id, `${id}.glb` ), 'utf8' ) ).toBe( 'fixture-shell' );

		}

	} );

	it( 'rejects malformed source shells and catalogs from a different seed or shell set', async () => {

		const ids = [ 'p0', 'p1' ];
		const { catalog } = await collectShellArtifacts( sources( ids ), ids, { seed: atlas.meta.seed } );
		writeFileSync( join( root, 'p1/p1.blueprint.json' ), '{}' );
		await expect( collectShellArtifacts( root, ids, { seed: atlas.meta.seed } ) ).rejects.toMatchObject( { code: 'E_SHELL_CATALOG' } );
		const out = new OutDir( root );
		for ( const invalid of [ { ...catalog, seed: 'other' }, { ...catalog, buildings: catalog.buildings.slice( 1 ) } ] ) {

			await expect( out.publishManifest( atlas, ids, [], { catalog: invalid } ) ).rejects.toMatchObject( { code: 'E_SHELL_CATALOG' } );

		}
		expect( validateWorldManifest( {
			contractVersion: '1.0.0', seed: atlas.meta.seed, atlasVersion: atlas.meta.version,
			named: false, namingTheme: null, parcels: [], interiors: [], floors: {},
			shellCatalog: { file: '../shells/index.json', encoding: 'archive', sha256: '0'.repeat( 64 ) }
		} ).length ).toBeGreaterThan( 0 );

	} );

} );
