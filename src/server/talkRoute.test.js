import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { talkRoute } from './talkRoute.js';

describe( 'NPC dialogue HTTP boundary', () => {

	let server = null;
	afterEach( async () => {

		if ( server ) await new Promise( ( resolve ) => server.close( resolve ) );
		server = null;

	} );

	it( 'accepts the exact GameApp snapshot including quests and returns the closed reply shape', async () => {

		const service = { reply: vi.fn( async () => 'Meet me by the station.' ) };
		const origin = await serve( service );
		const request = talkRequest();
		const response = await fetch( `${origin}/api/talk`, {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( request )
		} );
		expect( response.status ).toBe( 200 );
		expect( await response.json() ).toEqual( { reply: 'Meet me by the station.' } );
		expect( service.reply ).toHaveBeenCalledWith( request );

	} );

	it( 'rejects malformed, unknown and invalid request values before dialogue inference', async () => {

		const service = { reply: vi.fn() };
		const origin = await serve( service );
		for ( const body of [
			'{',
			JSON.stringify( { ...talkRequest(), unknown: true } ),
			JSON.stringify( { ...talkRequest(), timeMin: 'now' } )
		] ) {

			const response = await fetch( `${origin}/api/talk`, {
				method: 'POST', headers: { 'Content-Type': 'application/json' }, body
			} );
			expect( response.status ).toBe( 400 );
			expect( await response.json() ).toEqual( { error: expect.any( String ) } );

		}
		expect( service.reply ).not.toHaveBeenCalled();

	} );

	it( 'returns the closed service failure shape', async () => {

		const origin = await serve( { reply: vi.fn( async () => { throw new Error( 'text model unavailable' ); } ) } );
		const response = await fetch( `${origin}/api/talk`, {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( talkRequest() )
		} );
		expect( response.status ).toBe( 502 );
		expect( await response.json() ).toEqual( { error: 'text model unavailable' } );

	} );

	async function serve( service ) {

		let handler;
		talkRoute( '/unused', service ).configureServer( {
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

function talkRequest() {

	return {
		out: '/out/games/night-shift',
		npc: {
			npcId: 'npc.mara', name: { given: 'Mara', family: 'Voss' }, gender: 'female', appearanceSeed: 17,
			type: 'barista', home: { parcelId: 'p4', unit: 2 }, family: [], routine: [],
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
		} ]
	};

}
