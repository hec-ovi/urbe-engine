import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exteriorRoute } from './exteriorRoute.js';
import { ExteriorBuildService } from './ExteriorBuildService.js';
import { ExteriorBuildBoundary } from './ExteriorBuildBoundary.js';

describe( 'exact blueprint exterior HTTP jobs', () => {

	const cleanups = [];
	afterEach( async () => { for ( const cleanup of cleanups.splice( 0 ).reverse() ) await cleanup(); } );

	it( 'carries exact geometry to an isolated asynchronous batch and publishes verified progress and manifest', async () => {

		let release;
		let request;
		const gate = new Promise( ( resolve ) => { release = resolve; } );
		const { origin, root } = await fixture( async ( value ) => { request = value; await gate; finish( value ); } );
		const capability = await call( origin, 'GET' );
		expect( capability.body.available ).toBe( true );
		const input = blueprint();
		const first = await call( origin, 'POST', { blueprint: input } );
		expect( first.status ).toBe( 202 );
		expect( first.body.state ).toBe( 'queued' );
		expect( first.body.blueprintHash ).toMatch( /^[a-f0-9]{64}$/ );
		await expect.poll( () => Boolean( request ) ).toBe( true );
		expect( JSON.parse( readFileSync( request.blueprintPath, 'utf8' ) ) ).toEqual( input );
		expect( request.outDir.startsWith( join( root, 'out', 'atlas-exteriors-' ) ) ).toBe( true );
		writeShell( request.outDir, 'p0' );
		const running = await call( origin, 'GET', null, first.body.id );
		expect( running.body ).toMatchObject( { state: 'running', completed: 1, completedParcels: [ 'p0' ], manifest: null } );
		const second = await call( origin, 'POST', { blueprint: input } );
		expect( second.body.out ).not.toBe( first.body.out );
		expect( second.body.blueprintHash ).toBe( first.body.blueprintHash );
		expect( ( await call( origin, 'GET', null, second.body.id ) ).body.state ).toBe( 'queued' );
		release();
		const done = await settled( origin, first.body.id );
		expect( done.state ).toBe( 'succeeded' );
		expect( done.manifest.parcels ).toEqual( [ 'p0', 'p1' ] );
		expect( new ExteriorBuildBoundary().job( done ) ).toBe( true );
		await settled( origin, second.body.id );

	} );

	it( 'reports malformed input, unsafe ids, duplicate ids, missing jobs and unavailable runtime before mutation', async () => {

		let runs = 0;
		const { origin } = await fixture( async () => { runs ++; } );
		const malformed = await fetch( `${origin}/api/exteriors`, { method: 'POST', body: '{' } );
		expect( malformed.status ).toBe( 400 );
		for ( const input of [ {}, { blueprint: { ...blueprint(), parcels: [ { id: '../escape' } ] } }, { blueprint: { ...blueprint(), parcels: [ { id: 'p0' }, { id: 'p0' } ] } } ] ) {

			const invalid = await call( origin, 'POST', input );
			expect( invalid.status ).toBe( 400 );
			expect( invalid.body.code ).toBe( 'E_INVALID_REQUEST' );

		}
		expect( ( await call( origin, 'GET', null, 'absent' ) ).body.code ).toBe( 'E_JOB_NOT_FOUND' );
		expect( runs ).toBe( 0 );
		const unavailable = await fixture( null );
		expect( ( await call( unavailable.origin, 'GET' ) ).body.available ).toBe( false );
		expect( ( await call( unavailable.origin, 'POST', { blueprint: blueprint() } ) ).status ).toBe( 503 );

	} );

	it( 'rejects a symlink output root', async () => {

		const { origin, root } = await fixture( async () => {} );
		mkdirSync( join( root, 'elsewhere' ) );
		symlinkSync( join( root, 'elsewhere' ), join( root, 'out' ) );
		const result = await call( origin, 'POST', { blueprint: blueprint() } );
		expect( result.status ).toBe( 500 );
		expect( result.body.code ).toBe( 'E_STORAGE' );

	} );

	it( 'bounds uploaded input and retained jobs without replacing prior output', async () => {

		const small = await fixture( async () => {}, { maxRequestBytes: 16 } );
		expect( ( await call( small.origin, 'POST', { blueprint: blueprint() } ) ).status ).toBe( 413 );
		const limited = await fixture( async () => {}, { maxJobs: 1 } );
		const first = await call( limited.origin, 'POST', { blueprint: blueprint() } );
		await settled( limited.origin, first.body.id );
		const second = await call( limited.origin, 'POST', { blueprint: blueprint() } );
		expect( second.status ).toBe( 429 );
		expect( second.body.code ).toBe( 'E_BUSY' );
		expect( ( await call( limited.origin, 'GET', null, first.body.id ) ).status ).toBe( 200 );

	} );

	it( 'preserves Connections failures and refuses changed geometry or incomplete output', async () => {

		for ( const [ run, code ] of [
			[ async () => { throw new Error( 'E_CONNECTIONS: walking strip does not fit' ); }, 'E_BUILD_FAILED' ],
			[ async ( request ) => { finish( request ); const changed = blueprint(); changed.stats.changed = true; writeFileSync( request.blueprintPath, JSON.stringify( changed ) ); }, 'E_BUILD_INCOMPLETE' ],
			[ async () => {}, 'E_BUILD_INCOMPLETE' ]
		] ) {

			const { origin } = await fixture( run );
			const started = await call( origin, 'POST', { blueprint: blueprint() } );
			const done = await settled( origin, started.body.id );
			expect( done.state ).toBe( 'failed' );
			expect( done.error.code ).toBe( code );
			expect( done.manifest ).toBe( null );
			if ( code === 'E_BUILD_FAILED' ) expect( done.error.message ).toContain( 'E_CONNECTIONS' );

		}

	} );

	async function fixture( run, { maxJobs, maxRequestBytes } = {} ) {

		const root = mkdtempSync( join( tmpdir(), 'engine-exteriors-' ) );
		cleanups.push( () => rmSync( root, { recursive: true, force: true } ) );
		const service = new ExteriorBuildService( { engineRoot: root, maxJobs, ...( run ? { process: { capability: () => ( { contractVersion: '1.0', available: true, reason: null } ), run } } : {} ) } );
		const handler = exteriorRoute( root, service, maxRequestBytes );
		const server = createServer( ( req, res ) => handler( req, res, () => { res.statusCode = 404; res.end(); } ) );
		await new Promise( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
		cleanups.push( () => new Promise( ( resolve ) => server.close( resolve ) ) );
		return { root, origin: `http://127.0.0.1:${server.address().port}` };

	}

} );

function blueprint() {

	return { meta: { seed: 'same-seed', version: '0.2.4' }, parcels: [ { id: 'p0' }, { id: 'p1' } ], streets: { nodes: [], edges: [] }, districts: [], blocks: [], transit: {}, volumetric: {}, stats: {}, exactExtension: { geometry: [ 1.23456789, 2 ] } };

}

function writeShell( outDir, id ) {

	mkdirSync( join( outDir, id ), { recursive: true } );
	writeFileSync( join( outDir, id, `${id}.glb` ), 'glb fixture' );
	writeFileSync( join( outDir, id, `${id}.blueprint.json` ), '{}' );

}

function finish( { outDir } ) {

	for ( const id of [ 'p0', 'p1' ] ) writeShell( outDir, id );
	writeFileSync( join( outDir, 'manifest.json' ), JSON.stringify( { contractVersion: '1.0.0', seed: 'same-seed', atlasVersion: '0.2.4', named: false, namingTheme: null, parcels: [ 'p0', 'p1' ], interiors: [], floors: {} } ) );

}

async function call( origin, method, input, id = '' ) {

	const response = await fetch( `${origin}/api/exteriors${id ? `/${id}` : ''}`, { method, ...( input ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( input ) } : {} ) } );
	return { status: response.status, body: await response.json() };

}

async function settled( origin, id ) {

	let result;
	await expect.poll( async () => { result = ( await call( origin, 'GET', null, id ) ).body; return [ 'succeeded', 'failed' ].includes( result.state ); } ).toBe( true );
	return result;

}
