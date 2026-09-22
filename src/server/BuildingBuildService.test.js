import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BuildingBuildService } from './BuildingBuildService.js';
import { buildingRoute } from './buildingRoute.js';
import { buildPairedPreview } from '../building/build-preview.js';
import { sha256 } from '../building/PreviewRevision.js';

describe( 'POST /api/building', () => {

	let root;
	let server;

	afterEach( async () => {

		if ( server ) await new Promise( ( resolve ) => server.close( resolve ) );
		if ( root ) rmSync( root, { recursive: true, force: true } );
		server = null;
		root = null;

	} );

	it( 'builds each requested source once, reports the existing one after, and reuses an authored nested shell', async () => {

		const { service, builds } = fixture();
		const origin = await serve( service );

		const first = await post( origin, { parcel: 'p136', out: '/out/urbe' } );
		expect( first.status ).toBe( 200 );
		expect( first.body ).toEqual( { parcel: 'p136', out: '/out/urbe', source: 'shell', built: true } );
		expect( builds ).toEqual( [ { parcel: 'p136', source: 'shell', world: 'city-urbe.json', out: 'p136' } ] );

		expect( ( await post( origin, { parcel: 'p136', out: '/out/urbe' } ) ).body ).toEqual( {
			parcel: 'p136', out: '/out/urbe', source: 'shell', built: false
		} );

		const interior = await post( origin, { parcel: 'p136', out: '/out/urbe', source: 'interior' } );
		expect( interior.body ).toEqual( { parcel: 'p136', out: '/out/urbe', source: 'interior', built: true } );
		expect( ( await post( origin, { parcel: 'p136', out: '/out/urbe', source: 'interior' } ) ).body.built ).toBe( false );
		expect( builds.map( ( build ) => build.source ) ).toEqual( [ 'shell', 'interior' ] );

		const parcelDir = join( root, 'out', 'games', 'review', 'p136' );
		mkdirSync( parcelDir, { recursive: true } );
		writeFileSync( join( parcelDir, 'p136.blueprint.json' ), '{}' );
		writeFileSync( join( parcelDir, 'p136.glb' ), 'authored shell' );
		expect( ( await post( origin, { parcel: 'p136', out: '/out/games/review', source: 'shell' } ) ).body ).toEqual( {
			parcel: 'p136', out: '/out/games/review', source: 'shell', built: false
		} );
		expect( builds ).toHaveLength( 2 );

	} );

	it( 'returns closed visible errors for absent worlds, parcels and malformed input', async () => {

		const { service } = fixture();
		const origin = await serve( service );

		const world = await post( origin, { parcel: 'p136', out: '/out/missing' } );
		expect( world.status ).toBe( 404 );
		expect( world.body ).toMatchObject( { code: 'E_WORLD_NOT_FOUND' } );

		const parcel = await post( origin, { parcel: 'p404', out: '/out/urbe' } );
		expect( parcel.status ).toBe( 404 );
		expect( parcel.body ).toEqual( { code: 'E_PARCEL_NOT_FOUND', message: 'p404 is not a parcel in /out/urbe' } );

		for ( const request of [ { parcel: '../p136', out: '/out/urbe' }, { parcel: 'p136', out: '/out/games/../urbe' } ] ) {

			const invalid = await post( origin, request );
			expect( invalid.status ).toBe( 400 );
			expect( invalid.body.code ).toBe( 'E_INVALID_REQUEST' );

		}

		const malformed = await fetch( `${origin}/api/building`, { method: 'POST', body: '{' } );
		expect( malformed.status ).toBe( 400 );
		expect( await malformed.json() ).toEqual( { code: 'E_INVALID_REQUEST', message: 'request body is not valid JSON' } );

	} );

	it( 'reuses current paired previews and distinguishes Interior edits from Exterior edits at unchanged package versions', async () => {

		const paired = pairedFixture();
		const origin = await serve( paired.service );
		expect( ( await post( origin, { ...paired.input, request: paired.request } ) ).body.built ).toBe( true );
		const shell = readFileSync( join( paired.directory, 'review.glb' ) );
		expect( ( await post( origin, { ...paired.input, source: 'interior' } ) ).body.built ).toBe( false );
		expect( ( await post( origin, { ...paired.input, request: paired.request } ) ).body.built ).toBe( false );
		expect( paired.builds ).toEqual( { exterior: 1, interior: 1 } );

		write( join( root, 'interior/src/layout.js' ), 'fixed stair gaps' );
		expect( ( await post( origin, paired.input ) ).body.built ).toBe( true );
		expect( paired.builds ).toEqual( { exterior: 1, interior: 2 } );
		expect( readFileSync( join( paired.directory, 'review.glb' ) ) ).toEqual( shell );

		write( join( root, 'exterior/src/generator.js' ), 'fixed facade frames' );
		expect( ( await post( origin, paired.input ) ).body.built ).toBe( true );
		expect( paired.builds ).toEqual( { exterior: 2, interior: 3 } );
		expect( readFileSync( join( paired.directory, 'review.glb' ) ) ).not.toEqual( shell );

		write( join( root, 'interior/schemas/building.json' ), '{"updated":true}' );
		expect( ( await post( origin, paired.input ) ).body.built ).toBe( true );
		expect( paired.builds ).toEqual( { exterior: 2, interior: 4 } );
		write( join( root, 'engine/src/assembly/interiorRunner.js' ), 'updated adapter' );
		expect( ( await post( origin, paired.input ) ).body.built ).toBe( true );
		expect( paired.builds ).toEqual( { exterior: 2, interior: 5 } );
		write( join( root, 'interior/dist/feasibility.js' ), 'updated exterior core feasibility dependency' );
		expect( ( await post( origin, paired.input ) ).body.built ).toBe( true );
		expect( paired.builds ).toEqual( { exterior: 3, interior: 6 } );
		write( join( root, 'interior/src/layout.test.js' ), 'only a test changes' );
		expect( ( await post( origin, paired.input ) ).body.built ).toBe( false );
		expect( JSON.parse( readFileSync( join( root, 'interior/package.json' ) ) ).version ).toBe( '1.0.0' );

	} );

	it.each( [ 'interior/layouts/ground.json', 'interior/npc.json', 'shared/modules.json', 'shared/catalog.json', 'shared/wall.glb', 'shared/chair.glb', 'review.glb', 'review.blueprint.json' ] )(
		'rebuilds a pair whose published %s is missing', async file => {

			const paired = pairedFixture();
			const origin = await serve( paired.service );
			await post( origin, { ...paired.input, request: paired.request } );
			const path = file.startsWith( 'shared/' ) ? join( paired.sharedDir, file.slice( 7 ) ) : join( paired.directory, file );
			rmSync( path );
			expect( ( await post( origin, paired.input ) ).body.built ).toBe( true );
			expect( paired.builds ).toEqual( { exterior: file.startsWith( 'review.' ) ? 2 : 1, interior: 2 } );
			expect( ( await post( origin, paired.input ) ).body.built ).toBe( false );

		}
	);

	it.each( [ 'exterior', 'interior', 'resources', 'incomplete', 'source-edit' ] )( 'keeps the previous complete pair if %s fails before publication', async failure => {

		const paired = pairedFixture();
		const origin = await serve( paired.service );
		await post( origin, { ...paired.input, request: paired.request } );
		const previous = snapshot( paired.directory );
		write( join( root, 'exterior/src/generator.js' ), 'new exterior' );
		paired.control.failure = failure;
		const failed = await post( origin, paired.input );
		expect( failed.status ).toBe( 500 );
		expect( failed.body.code ).toBe( 'E_BUILD_FAILED' );
		expect( snapshot( paired.directory ) ).toEqual( previous );
		expect( readdirSync( dirname( paired.directory ) ) ).toEqual( [ 'review' ] );
		paired.control.failure = null;
		expect( ( await post( origin, paired.input ) ).body.built ).toBe( true );
		expect( ( await post( origin, paired.input ) ).body.built ).toBe( false );

	} );

	it( 'migrates legacy preview metadata once and refuses to replace a request under an existing id', async () => {

		const paired = pairedFixture();
		const origin = await serve( paired.service );
		await post( origin, { ...paired.input, request: paired.request } );
		const path = join( paired.directory, 'preview.json' );
		const preview = JSON.parse( readFileSync( path ) );
		delete preview.revisions;
		write( path, JSON.stringify( preview ) );
		expect( ( await post( origin, paired.input ) ).body.built ).toBe( true );
		expect( paired.builds ).toEqual( { exterior: 2, interior: 2 } );
		const replaced = await post( origin, { ...paired.input, request: { ...paired.request, seed: 'another' } } );
		expect( replaced.status ).toBe( 409 );
		expect( paired.builds ).toEqual( { exterior: 2, interior: 2 } );

	} );

	it( 'coalesces simultaneous exterior and interior opens into one paired build', async () => {

		const paired = pairedFixture();
		const buildPaired = paired.service.buildPaired;
		paired.service.buildPaired = async options => {

			await new Promise( resolve => setTimeout( resolve, 30 ) );
			return buildPaired( options );

		};
		const origin = await serve( paired.service );
		const responses = await Promise.all( [ 'shell', 'interior', 'shell' ].map( source => post( origin, {
			...paired.input, request: paired.request, source
		} ) ) );
		for ( const response of responses ) expect( response ).toMatchObject( { status: 200, body: { built: true } } );
		expect( paired.builds ).toEqual( { exterior: 1, interior: 1 } );

	} );

	function pairedFixture() {

		root = mkdtempSync( join( tmpdir(), 'engine-paired-' ) );
		const engineRoot = join( root, 'engine' );
		for ( const producer of [ 'exterior', 'interior' ] ) {

			write( join( root, producer, 'package.json' ), '{"version":"1.0.0"}' );
			write( join( root, producer, 'src/generator.js' ), 'original generator' );

		}
		const directory = join( engineRoot, 'out/previews/review' );
		const sharedDir = join( engineRoot, 'out/shared/interior-modules/test' );
		const builds = { exterior: 0, interior: 0 };
		const control = { failure: null };
		const request = { seed: 'review', buildingId: 'review',
			parcel: { footprint: [ [ 0, 0 ], [ 36, 0 ], [ 36, 30 ], [ 0, 30 ] ], accessPoint: [ 18, - 2 ], maxHeight: 30 },
			building: { type: 'corpo', tier: 'high_rich', floors: 2 }, theme: 'cyberpunk' };
		const service = new BuildingBuildService( {
			engineRoot, atlasDir: join( root, 'atlas' ),
			buildPaired: options => buildPairedPreview( { ...options,
				generateExterior: async () => {

					builds.exterior ++;
					if ( control.failure === 'exterior' ) throw new Error( 'exterior failed' );
					return { blueprint: { floors: [ { index: 0 }, { index: 1 } ], revision: builds.exterior }, glb: Buffer.from( `shell ${builds.exterior}` ) };

				},
				generateInterior: async ( _request, target ) => {

					builds.interior ++;
					const building = { buildingId: 'review', generatorVersion: '1.0.0', layouts: { ground: 'layouts/ground.json' },
						floors: [ { index: 0, layout: 'ground' }, { index: 1, layout: 'ground' } ] };
					if ( control.failure === 'incomplete' ) building.floors.pop();
					write( join( target, 'building.json' ), JSON.stringify( building ) );
					write( join( target, 'layouts/ground.json' ), JSON.stringify( { revision: builds.interior } ) );
					write( join( target, 'npc.json' ), '{}' );
					if ( control.failure === 'interior' ) throw new Error( 'interior failed after writing files' );
					if ( control.failure === 'source-edit' ) write( join( root, 'interior/src/generator.js' ), 'changed while building' );
					return building;

				},
				publishResources: async () => {

					if ( control.failure === 'resources' ) throw new Error( 'resources failed' );
					const modules = JSON.stringify( { modules: [ { file: 'wall.glb' } ] } );
					const props = JSON.stringify( { assets: [ { modelUri: 'chair.glb' } ] } );
					for ( const [ name, bytes ] of Object.entries( { 'modules.json': modules, 'catalog.json': props, 'wall.glb': 'wall', 'chair.glb': 'chair' } ) ) write( join( sharedDir, name ), bytes );
					return { modules: { shared: 'interior-modules/test', file: 'modules.json', sha256: sha256( modules ) },
						props: { shared: 'interior-modules/test', file: 'catalog.json', sha256: sha256( props ) } };

				}
			} )
		} );
		return { service, builds, control, request, directory, sharedDir, input: { parcel: 'review', out: '/out/previews' } };

	}

	function fixture() {

		root = mkdtempSync( join( tmpdir(), 'engine-building-' ) );
		const atlasDir = join( root, 'atlas' );
		mkdirSync( atlasDir );
		writeFileSync( join( atlasDir, 'city-urbe.json' ), JSON.stringify( { meta: { seed: 'urbe' }, parcels: [ { id: 'p136' } ] } ) );
		const builds = [];
		const service = new BuildingBuildService( {
			engineRoot: root,
			atlasDir,
			build: async ( request ) => {

				builds.push( { parcel: request.parcel, source: request.source, world: request.blueprintPath.split( '/' ).at( - 1 ), out: request.outDir.split( '/' ).at( - 1 ) } );
				mkdirSync( request.outDir, { recursive: true } );
				writeFileSync( join( request.outDir, `${request.parcel}.blueprint.json` ), '{}' );
				writeFileSync( join( request.outDir, `${request.parcel}.glb` ), 'glb' );
				if ( request.source === 'interior' ) {

					mkdirSync( join( request.outDir, 'interior' ) );
					writeFileSync( join( request.outDir, 'interior', 'building.glb' ), 'glb' );

				}

			}
		} );
		return { service, builds };

	}

	async function serve( service ) {

		let handler;
		buildingRoute( root, join( root, 'atlas' ), service ).configureServer( {
			middlewares: { use( _path, callback ) { handler = callback; } }
		} );
		server = createServer( ( request, response ) => handler( request, response, () => {

			response.statusCode = 404;
			response.end();

		} ) );
		await new Promise( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
		return `http://127.0.0.1:${server.address().port}`;

	}

} );

function write( path, bytes ) {

	mkdirSync( dirname( path ), { recursive: true } );
	writeFileSync( path, bytes );

}

function snapshot( directory ) {

	return Object.fromEntries( readdirSync( directory, { recursive: true, withFileTypes: true } )
		.filter( entry => entry.isFile() ).map( entry => {

			const path = join( entry.parentPath, entry.name );
			return [ path.slice( directory.length + 1 ), readFileSync( path ).toString( 'base64' ) ];

		} ) );

}

async function post( origin, body ) {

	const response = await fetch( `${origin}/api/building`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( body )
	} );
	return { status: response.status, body: await response.json() };

}
