import { afterEach, describe, expect, it } from 'vitest';
import { createServer, get } from 'node:http';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { staticMount, TRANSCODER_TYPES } from './staticMount.js';

describe( 'static mount of a sibling store', () => {

	const servers = [];
	const dirs = [];
	afterEach( async () => {

		for ( const server of servers.splice( 0 ) ) {

			server.closeAllConnections();
			await new Promise( ( resolve ) => server.close( resolve ) );

		}
		for ( const dir of dirs.splice( 0 ) ) await rm( dir, { recursive: true, force: true } );

	} );

	/**
	 * The catalog publishes a compressed sibling beside each PNG master. Handed
	 * the page instead, three's KTX2 loader decodes HTML and every map in the
	 * city falls back to its PNG a round trip later, which is how a whole
	 * city's maps once loaded as PNG with their build outputs sitting on disk.
	 */
	it( 'serves a compressed map as image/ktx2 and a map the catalog names but the build has not written as 404, not the page', async () => {

		const { origin } = await store( { 'cyberpunk/wall/basecolor.ktx2': 'KTX 20' } );

		const map = await fetch( `${origin}/materials/cyberpunk/wall/basecolor.ktx2` );
		expect( map.status ).toBe( 200 );
		expect( map.headers.get( 'content-type' ) ).toBe( 'image/ktx2' );
		expect( await map.text() ).toBe( 'KTX 20' );

		const absent = await fetch( `${origin}/materials/cyberpunk/wall/normal.ktx2` );
		expect( absent.status ).toBe( 404 );
		expect( absent.headers.get( 'cache-control' ) ).toBe( 'no-store' );
		expect( await absent.text() ).toBe( '' );

	} );

	/**
	 * Each open of the game used to download every map again (no-store), a
	 * few hundred megabytes. A map keeps its name across releases, so the
	 * browser keeps its copy and asks: an unchanged file is a 304 with no body,
	 * a rewritten one arrives whole under a new tag.
	 */
	it( 'lets the browser keep a map and revalidate it, answering 304 while the file is unchanged and the new bytes once it is rewritten', async () => {

		const { origin, dir } = await store( { 'cyberpunk/wall/basecolor.png': 'first' } );
		const url = `${origin}/materials/cyberpunk/wall/basecolor.png`;

		const first = await fetch( url );
		const tag = first.headers.get( 'etag' );
		expect( first.headers.get( 'cache-control' ) ).toBe( 'no-cache' );
		expect( first.headers.get( 'content-type' ) ).toBe( 'image/png' );
		expect( tag ).toMatch( /^W\/"[0-9a-f]+-[0-9a-f]+"$/ );
		expect( await first.text() ).toBe( 'first' );

		const same = await fetch( url, { headers: { 'If-None-Match': `W/"other", ${tag}` } } );
		expect( same.status ).toBe( 304 );
		expect( same.headers.get( 'etag' ) ).toBe( tag );
		expect( await same.text() ).toBe( '' );

		await writeFile( join( dir, 'cyberpunk/wall/basecolor.png' ), 'second' );
		await utimes( join( dir, 'cyberpunk/wall/basecolor.png' ), new Date(), new Date( Date.now() + 5000 ) );
		const changed = await fetch( url, { headers: { 'If-None-Match': tag } } );
		expect( changed.status ).toBe( 200 );
		expect( changed.headers.get( 'etag' ) ).not.toBe( tag );
		expect( await changed.text() ).toBe( 'second' );

		const head = await fetch( url, { method: 'HEAD' } );
		expect( head.status ).toBe( 200 );
		expect( head.headers.get( 'content-length' ) ).toBe( '6' );

	} );

	it( 'serves the Basis transcoder\'s script and WebAssembly with their own types and leaves everything else in its folder to the next handler', async () => {

		const { origin } = await store( { 'basis_transcoder.js': 'var BASIS;', 'basis_transcoder.wasm': '\0asm', 'README.md': '# basis' }, '/basis', TRANSCODER_TYPES );

		const script = await fetch( `${origin}/basis/basis_transcoder.js` );
		expect( script.headers.get( 'content-type' ) ).toBe( 'text/javascript' );
		expect( await script.text() ).toBe( 'var BASIS;' );
		const wasm = await fetch( `${origin}/basis/basis_transcoder.wasm` );
		expect( wasm.headers.get( 'content-type' ) ).toBe( 'application/wasm' );
		expect( ( await fetch( `${origin}/basis/README.md` ) ).status ).toBe( 418 );

	} );

	it( 'never reads outside its folder and passes other methods on', async () => {

		const { origin } = await store( { 'cyberpunk/theme.json': '{}' } );

		expect( await status( `${origin}/materials/..%2f..%2f..%2fetc%2fpasswd.json` ) ).toBe( 418 );
		expect( ( await fetch( `${origin}/materials/cyberpunk/theme.json`, { method: 'POST', body: '{}' } ) ).status ).toBe( 418 );
		expect( ( await fetch( `${origin}/materials/cyberpunk` ) ).status ).toBe( 418 );

	} );

	/** The status of a GET sent with its path exactly as written, which fetch would normalise first. */
	function status( url ) {

		return new Promise( ( resolve, reject ) => {

			const { hostname, port, pathname } = new URL( url );
			get( { hostname, port, path: pathname }, ( response ) => {

				response.resume();
				resolve( response.statusCode );

			} ).on( 'error', reject );

		} );

	}

	/** A folder of `files` mounted at `prefix` behind a server whose next handler answers 418. */
	async function store( files, prefix = '/materials', types ) {

		const dir = await mkdtemp( join( tmpdir(), 'urbe-mount-' ) );
		dirs.push( dir );
		for ( const [ path, content ] of Object.entries( files ) ) {

			await mkdir( join( dir, path, '..' ), { recursive: true } );
			await writeFile( join( dir, path ), content );

		}
		let mounted;
		let handler;
		staticMount( 'test', prefix, dir, types ).configureServer( { middlewares: { use( path, callback ) { mounted = path; handler = callback; } } } );
		const server = createServer( ( request, response ) => {

			const next = () => { response.statusCode = 418; response.end(); };
			if ( ! request.url.startsWith( `${mounted}/` ) ) return next();
			request.url = request.url.slice( mounted.length );
			handler( request, response, next );

		} );
		servers.push( server );
		await new Promise( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
		return { origin: `http://127.0.0.1:${server.address().port}`, dir };

	}

} );
