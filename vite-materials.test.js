import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer } from 'vite';

let server;
let origin;

beforeAll( async () => {

	server = await createServer( {
		configFile: fileURLToPath( new URL( './vite.config.js', import.meta.url ) ),
		logLevel: 'silent',
		server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
		optimizeDeps: { noDiscovery: true, include: [] }
	} );
	await server.listen();
	origin = `http://127.0.0.1:${server.httpServer.address().port}`;

} );

afterAll( async () => { await server?.close(); } );

it( 'serves Materials bindings independently of theme maps', async () => {

	for ( const [ route, source ] of [
		[ '/materials/bindings/street-markings.json', '../materials/bindings/street-markings.json' ],
		[ '/materials/cyberpunk/theme.json', '../materials/themes/cyberpunk/theme.json' ]
	] ) {

		const response = await fetch( `${origin}${route}` );
		expect( response.status ).toBe( 200 );
		expect( response.headers.get( 'content-type' ) ).toContain( 'application/json' );
		expect( response.headers.get( 'cache-control' ) ).toBe( 'no-cache' );
		expect( response.headers.get( 'etag' ) ).toBeTruthy();
		expect( await response.text() ).toBe( await readFile( new URL( source, import.meta.url ), 'utf8' ) );

	}

} );

it( 'serves three\'s Basis transcoder for compressed maps, and answers 404 for a map that is not on disk', async () => {

	const script = await fetch( `${origin}/basis/basis_transcoder.js` );
	expect( script.status ).toBe( 200 );
	expect( script.headers.get( 'content-type' ) ).toBe( 'text/javascript' );
	const wasm = await fetch( `${origin}/basis/basis_transcoder.wasm` );
	expect( wasm.status ).toBe( 200 );
	expect( wasm.headers.get( 'content-type' ) ).toBe( 'application/wasm' );
	expect( new Uint8Array( await wasm.arrayBuffer() ).subarray( 0, 4 ) ).toEqual( new Uint8Array( [ 0, 0x61, 0x73, 0x6d ] ) );

	expect( ( await fetch( `${origin}/materials/cyberpunk/assets/no-such-map.ktx2` ) ).status ).toBe( 404 );

} );
