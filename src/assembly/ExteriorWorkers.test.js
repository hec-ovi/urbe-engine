import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExteriorWorkers } from './ExteriorWorkers.js';

const request = {
	seed: 'worker-contract', buildingId: 'p1', theme: 'cyberpunk', apertures: [],
	parcel: { footprint: [ [ 0, 0 ], [ 20, 0 ], [ 20, 16 ], [ 0, 16 ] ], accessPoint: [ 10, - 1 ], maxHeight: 16 },
	building: { type: 'residential', tier: 'mid', floors: 3 },
	options: { glb: 'merged', doorMotion: 'pocket', signage: null }
};

describe( 'persistent Exterior producer workers', () => {
	it( 'writes deterministic producer shells across queued jobs and recovers from invalid input', async () => {

		const root = await mkdtemp( join( tmpdir(), 'urbe-exterior-workers-' ) );
		const pool = new ExteriorWorkers( 1 );
		try {

			await expect( pool.run( { ...request, building: { ...request.building, floors: - 1 } }, join( root, 'bad' ) ) ).rejects.toThrow( 'E_' );
			const [ a, b ] = await Promise.all( [ pool.run( request, join( root, 'a' ) ), pool.run( request, join( root, 'b' ) ) ] );
			expect( a ).toEqual( b );
			expect( a.floors.filter( floor => floor.index >= 0 ) ).toHaveLength( 3 );
			for ( const file of [ 'p1.glb', 'p1.blueprint.json' ] ) {

				const bytes = await readFile( join( root, 'a', file ) );
				expect( bytes.length ).toBeGreaterThan( 100 );
				expect( await readFile( join( root, 'b', file ) ) ).toEqual( bytes );

			}

		} finally { await pool.close(); await rm( root, { recursive: true, force: true } ); }
		await expect( pool.run( request, root ) ).rejects.toThrow( 'closed' );

	}, 30000 );

	it( 'rejects unfinished jobs when the pool closes', async () => {

		const pool = new ExteriorWorkers( 1 );
		const jobs = Promise.allSettled( [ pool.run( request, 'unused' ), pool.run( request, 'unused' ) ] );
		await pool.close();
		expect( ( await jobs ).every( result => result.status === 'rejected' ) ).toBe( true );
		expect( () => new ExteriorWorkers( 0 ) ).toThrow( 'worker count' );

	} );
} );
