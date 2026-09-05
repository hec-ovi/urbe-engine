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
		expect( response.headers.get( 'cache-control' ) ).toBe( 'no-store' );
		expect( await response.text() ).toBe( await readFile( new URL( source, import.meta.url ), 'utf8' ) );

	}

} );
