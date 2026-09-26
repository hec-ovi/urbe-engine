import { describe, it, expect } from 'vitest';
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

	it( 'writes deterministic producer shells across queued jobs, and closing rejects what is unfinished', async () => {

		const root = await mkdtemp( join( tmpdir(), 'urbe-exterior-workers-' ) );
		const pool = new ExteriorWorkers( 1 );

		expect( () => new ExteriorWorkers( 0 ) ).toThrow( 'worker count' );

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
			// Only programs read a blueprint: it is written compact.
			expect( await readFile( join( root, 'a', 'p1.blueprint.json' ), 'utf8' ) ).toBe( JSON.stringify( a ) + '\n' );

			// A shell replaces its names whole, so a world that shares the old file by a hard link keeps it.
			const shared = join( root, 'shared.glb' );
			await writeFile( shared, 'the shell another world stands on' );
			await mkdir( join( root, 'e' ) );
			await link( shared, join( root, 'e', 'p1.glb' ) );
			await pool.run( request, join( root, 'e' ) );
			expect( await readFile( shared, 'utf8' ) ).toBe( 'the shell another world stands on' );
			expect( await readFile( join( root, 'e', 'p1.glb' ) ) ).toEqual( await readFile( join( root, 'a', 'p1.glb' ) ) );

			const unfinished = Promise.allSettled( [ pool.run( request, join( root, 'c' ) ), pool.run( request, join( root, 'd' ) ) ] );

			await pool.close();
			expect( ( await unfinished ).every( result => result.status === 'rejected' ) ).toBe( true );

		} finally { await pool.close(); await rm( root, { recursive: true, force: true } ); }

		await expect( pool.run( request, root ) ).rejects.toThrow( 'closed' );

	}, 30000 );

} );
