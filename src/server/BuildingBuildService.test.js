import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BuildingBuildService } from './BuildingBuildService.js';
import { buildingRoute } from './buildingRoute.js';

describe( 'POST /api/building', () => {

	let root;
	let server;

	afterEach( async () => {

		if ( server ) await new Promise( ( resolve ) => server.close( resolve ) );
		if ( root ) rmSync( root, { recursive: true, force: true } );
		server = null;
		root = null;

	} );

	it( 'builds the selected parcel from its Atlas sample once and reports the existing exterior thereafter', async () => {

		const { service, builds } = fixture();
		const origin = await serve( service );

		const first = await post( origin, { parcel: 'p136', out: '/out/urbe' } );
		expect( first.status ).toBe( 200 );
		expect( first.body ).toEqual( { parcel: 'p136', out: '/out/urbe', built: true } );
		expect( builds ).toEqual( [ { parcel: 'p136', world: 'city-urbe.json', out: 'p136' } ] );

		const second = await post( origin, { parcel: 'p136', out: '/out/urbe' } );
		expect( second.body ).toEqual( { parcel: 'p136', out: '/out/urbe', built: false } );
		expect( builds ).toHaveLength( 1 );

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

		const invalid = await post( origin, { parcel: '../p136', out: '/out/urbe' } );
		expect( invalid.status ).toBe( 400 );
		expect( invalid.body.code ).toBe( 'E_INVALID_REQUEST' );

		const malformed = await fetch( `${origin}/api/building`, { method: 'POST', body: '{' } );
		expect( malformed.status ).toBe( 400 );
		expect( await malformed.json() ).toEqual( { code: 'E_INVALID_REQUEST', message: 'request body is not valid JSON' } );

	} );

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

				builds.push( { parcel: request.parcel, world: request.blueprintPath.split( '/' ).at( - 1 ), out: request.outDir.split( '/' ).at( - 1 ) } );
				mkdirSync( request.outDir, { recursive: true } );
				writeFileSync( join( request.outDir, `${request.parcel}.blueprint.json` ), '{}' );
				writeFileSync( join( request.outDir, `${request.parcel}.glb` ), 'glb' );

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

async function post( origin, body ) {

	const response = await fetch( `${origin}/api/building`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( body )
	} );
	return { status: response.status, body: await response.json() };

}
