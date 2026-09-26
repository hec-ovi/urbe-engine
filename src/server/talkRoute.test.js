import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { talkRoute } from './talkRoute.js';

describe( 'NPC dialogue HTTP boundary', () => {

	const servers = [];
	afterEach( async () => {

		for ( const server of servers.splice( 0 ) ) {

			server.closeAllConnections();
			await new Promise( ( resolve ) => server.close( resolve ) );

		}

	} );

	it( 'accepts the exact GameApp snapshot including quests and returns the closed reply shape', async () => {

		const service = { reply: vi.fn( async () => 'Meet me by the station.' ) };
		const origin = await serve( service );
		const request = talkRequest();
		const response = await post( origin, '/api/talk', JSON.stringify( request ) );
		expect( response.status ).toBe( 200 );
		expect( await response.json() ).toEqual( { reply: 'Meet me by the station.' } );
		expect( service.reply ).toHaveBeenCalledWith( request, { signal: expect.any( AbortSignal ) } );

	} );

	it( 'refuses malformed or invalid requests before inference and reports service failures as a bad gateway', async () => {

		const service = { reply: vi.fn(), stream: vi.fn() };
		const origin = await serve( service );
		for ( const path of [ '/api/talk', '/api/talk/stream' ] ) {

			for ( const body of [
				'{',
				JSON.stringify( { ...talkRequest(), unknown: true } ),
				JSON.stringify( { ...talkRequest(), npc: { ...talkRequest().npc, mood: 'tired' } } ),
				JSON.stringify( { ...talkRequest(), timeMin: 'now' } ),
				JSON.stringify( { ...talkRequest(), out: '/out/../src' } )
			] ) {

				const response = await post( origin, path, body );
				expect( response.status ).toBe( 400 );
				expect( await response.json() ).toEqual( { error: expect.any( String ) } );

			}

		}
		expect( service.reply ).not.toHaveBeenCalled();
		expect( service.stream ).not.toHaveBeenCalled();

		for ( const failure of [ new Error( 'text model unavailable' ), new SyntaxError( 'model or world response is malformed' ) ] ) {

			const failing = await serve( { reply: vi.fn( async () => { throw failure; } ) } );
			const response = await post( failing, '/api/talk', JSON.stringify( talkRequest() ) );
			expect( response.status ).toBe( 502 );
			expect( await response.json() ).toEqual( { error: failure.message } );

		}

	} );

	it( 'streams the reply as checked NDJSON events', async () => {

		const events = [
			{ type: 'delta', text: 'Meet me. ' }, { type: 'sentence', index: 0, text: 'Meet me.' },
			{ type: 'delta', text: 'By the station.' }, { type: 'sentence', index: 1, text: 'By the station.' },
			{ type: 'offer', kind: 'follow' }, { type: 'done', reply: 'Meet me. By the station.' }
		];
		const service = { stream: vi.fn( async function* () { yield* events; } ) };
		const response = await post( await serve( service ), '/api/talk/stream', JSON.stringify( talkRequest() ) );
		expect( response.status ).toBe( 200 );
		expect( response.headers.get( 'content-type' ) ).toMatch( /^application\/x-ndjson/ );
		expect( lines( await response.text() ) ).toEqual( events );
		expect( service.stream ).toHaveBeenCalledWith( talkRequest(), { signal: expect.any( AbortSignal ) } );

	} );

	it( 'answers a failure before the first event with 502 and a later one with an error event', async () => {

		const early = { stream: vi.fn( async function* () { throw new Error( 'model server 503 at x' ); } ) };
		const refused = await post( await serve( early ), '/api/talk/stream', JSON.stringify( talkRequest() ) );
		expect( refused.status ).toBe( 502 );
		expect( await refused.json() ).toEqual( { error: 'model server 503 at x' } );

		const late = { stream: vi.fn( async function* () {

			yield { type: 'delta', text: 'Meet' };
			throw new Error( 'model stream ended before [DONE]' );

		} ) };
		const broken = await post( await serve( late ), '/api/talk/stream', JSON.stringify( talkRequest() ) );
		expect( broken.status ).toBe( 200 );
		expect( lines( await broken.text() ) ).toEqual( [
			{ type: 'delta', text: 'Meet' }, { type: 'error', error: 'model stream ended before [DONE]' }
		] );

		const invalid = { stream: vi.fn( async function* () { yield { type: 'delta', text: '' }; } ) };
		const refusedOutput = await post( await serve( invalid ), '/api/talk/stream', JSON.stringify( talkRequest() ) );
		expect( refusedOutput.status ).toBe( 502 );
		expect( ( await refusedOutput.json() ).error ).toMatch( /talk event does not match its contract/ );

	} );

	it( 'aborts the reply when the browser goes away', async () => {

		let stopped;
		const gone = new Promise( ( resolve ) => stopped = resolve );
		const service = { stream: vi.fn( async function* ( _request, { signal } ) {

			yield { type: 'delta', text: 'Meet' };
			await new Promise( ( _resolve, reject ) => signal.addEventListener( 'abort', () => {

				stopped( signal );
				reject( signal.reason );

			} ) );

		} ) };
		const controller = new AbortController();
		const response = await post( await serve( service ), '/api/talk/stream', JSON.stringify( talkRequest() ), controller.signal );
		expect( await response.body.getReader().read() ).toMatchObject( { done: false } );
		controller.abort();
		expect( ( await gone ).aborted ).toBe( true );

	} );

	it( 'leaves other methods and paths to the next middleware', async () => {

		const origin = await serve( { reply: vi.fn(), stream: vi.fn() } );
		expect( ( await fetch( `${origin}/api/talk` ) ).status ).toBe( 404 );
		expect( ( await post( origin, '/api/talk/other', JSON.stringify( talkRequest() ) ) ).status ).toBe( 404 );

	} );

	function post( origin, path, body, signal ) {

		return fetch( `${origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal } );

	}

	/** Serves the plugin behind connect's prefix rule: the mount path leaves `req.url`. */
	async function serve( service ) {

		let mount;
		let handler;
		talkRoute( '/unused', service ).configureServer( {
			middlewares: { use( path, callback ) { mount = path; handler = callback; } }
		} );
		const notFound = ( response ) => {

			response.statusCode = 404;
			response.end();

		};
		const server = createServer( ( request, response ) => {

			if ( request.url !== mount && ! request.url.startsWith( `${mount}/` ) ) return notFound( response );
			request.url = request.url.slice( mount.length ) || '/';
			handler( request, response, () => notFound( response ) );

		} );
		servers.push( server );
		await new Promise( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
		return `http://127.0.0.1:${server.address().port}`;

	}

} );

function lines( text ) {

	return text.split( '\n' ).filter( Boolean ).map( ( line ) => JSON.parse( line ) );

}

function talkRequest() {

	return {
		out: '/out/games/night-shift',
		npc: {
			npcId: 'npc.mara', name: { given: 'Mara', family: 'Voss' }, gender: 'female', age: 42, traits: [ 'ambitious', 'dependable' ],
			appearanceSeed: 17, type: 'barista', home: { parcelId: 'p4', unit: 2 }, family: [], routine: [],
			flags: { dead: false, custom: [] }
		},
		behavior: {
			mode: 'interior', activity: 'working', place: { kind: 'parcel', id: 'p4' }, interrupted: true,
			interior: { at: { anchorId: 'counter', animation: 'work_serve', untilMin: 620 } }
		},
		line: 'Where is the witness?',
		timeMin: 600,
		quests: [ {
			id: 'main', cast: { witness: 'npc.mara' },
			state: { activeStepIds: [ 'find-witness' ], completedStepIds: [], flags: [] }
		} ],
		offers: { follow: true },
		guide: { placeId: 'p4', kind: 'parcel' }
	};

}
