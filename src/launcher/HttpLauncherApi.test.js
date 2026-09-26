import { describe, expect, it, vi } from 'vitest';
import { HttpLauncherApi } from './HttpLauncherApi.js';

const answer = ( body, status = 200 ) => Promise.resolve( new Response( JSON.stringify( body ), {
	status, headers: { 'Content-Type': 'application/json' }
} ) );

describe( 'HttpLauncherApi', () => {

	it( 'posts one method envelope with the global receiver a browser fetch needs, and surfaces a rejection message', async () => {

		const fetcher = vi.fn( function( url, options ) {

			expect( this ).toBe( globalThis );
			expect( url ).toBe( '/api/launcher' );
			expect( JSON.parse( options.body ) ).toEqual( { method: 'catalog' } );
			return answer( { games: [], cities: [] } );

		} );
		await expect( new HttpLauncherApi( fetcher ).catalog() ).resolves.toEqual( { games: [], cities: [] } );
		expect( fetcher ).toHaveBeenCalledOnce();

		const refused = () => answer( { message: 'city is incomplete' }, 409 );
		await expect( new HttpLauncherApi( refused ).createGame( {} ) ).rejects.toThrow( 'city is incomplete' );

	} );

	it( 'submits a creation stage as a job and reads it until it settles, through a dropped read', async () => {

		const job = { id: 'creation-1', method: 'generateQuests', result: null, error: null };
		const reads = [
			() => Promise.reject( new TypeError( 'network changed' ) ),
			() => answer( { ...job, state: 'running' } ),
			() => answer( { ...job, state: 'succeeded', result: { quests: { id: 'q', mainSteps: 6, sideJobs: 1 } } } )
		];
		const fetcher = vi.fn( ( url, options ) => {

			if ( url === '/api/creation-jobs' ) {

				expect( JSON.parse( options.body ) ).toEqual( { method: 'generateQuests', input: { cityId: 'c' } } );
				return answer( { ...job, state: 'queued' }, 202 );

			}
			expect( url ).toBe( '/api/creation-jobs/creation-1' );
			return reads.shift()();

		} );
		const wait = vi.fn( () => Promise.resolve() );
		const api = new HttpLauncherApi( fetcher, { wait, pollMs: 5 } );

		await expect( api.generateQuests( { cityId: 'c' } ) ).resolves.toEqual( { quests: { id: 'q', mainSteps: 6, sideJobs: 1 } } );
		expect( wait ).toHaveBeenCalledTimes( 3 );
		expect( wait ).toHaveBeenCalledWith( 5 );

		const failing = new HttpLauncherApi( ( url ) => url === '/api/creation-jobs'
			? answer( { ...job, state: 'queued' }, 202 )
			: answer( { ...job, state: 'failed', error: { code: 'E_COMMAND_FAILED', message: 'atlas exited 1' } } ), { wait } );
		await expect( failing.generateCity( { size: 'small' } ) ).rejects.toThrow( 'atlas exited 1' );

	} );

} );
