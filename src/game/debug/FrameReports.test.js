import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { FrameReports } from './FrameReports.js';
import { hitchReportPlugin } from './hitchReportPlugin.js';

const snapshot = () => ( { game: 'review', stats: { gpuMs: 7 }, memory: { textures: 4 }, position: [ 1, 2, 3 ] } );

it( 'sends bounded gap reports once per second and collects scene counters only then', () => {

	const send = vi.fn(), collect = vi.fn( snapshot );
	const reports = new FrameReports( send, collect );
	for ( let i = 1; i <= 25; i ++ ) reports.frame( i * 20, 60, [ 'render 55 ms' ] );
	expect( collect ).not.toHaveBeenCalled();
	reports.frame( 1000, 16, [] );
	expect( send ).toHaveBeenCalledTimes( 1 );
	const report = send.mock.calls[ 0 ][ 0 ];
	expect( report.frames ).toEqual( { count: 26, median: 60, p95: 60, worst: 60 } );
	expect( report.hitches ).toHaveLength( 20 );
	expect( report.hitches[ 0 ].notes ).toEqual( [ 'render 55 ms' ] );
	reports.frame( 2000, 16, [] );
	expect( send.mock.calls[ 1 ][ 0 ].hitches ).toEqual( [] );

} );

it( 'writes schema-valid development events to local storage and discards malformed ones', async () => {

	const directory = await mkdtemp( join( tmpdir(), 'game-reports-' ) );
	try {

		const ws = new EventEmitter();
		hitchReportPlugin( directory ).configureServer( { ws, config: { logger: { warn: vi.fn() } } } );
		ws.emit( 'urbe:performance', { unwanted: true } );
		const reports = new FrameReports( report => ws.emit( 'urbe:performance', report ), snapshot );
		reports.frame( 1000, 85, [ 'physics/player 5 ms', 'render 70 ms' ] );
		await vi.waitFor( async () => {

			const stored = JSON.parse( await readFile( join( directory, 'performance.json' ) ) );
			expect( stored ).toHaveLength( 1 );
			expect( stored[ 0 ].frames.worst ).toBe( 85 );
			expect( stored[ 0 ].hitches[ 0 ].notes ).toContain( 'render 70 ms' );

		} );

	} finally { await rm( directory, { recursive: true, force: true } ); }

} );

it( 'keeps gameplay running when reporting fails', () => {

	const warning = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
	try {

		const reports = new FrameReports( () => { throw new Error( 'closed' ); }, snapshot );
		expect( () => reports.frame( 1000, 60, [] ) ).not.toThrow();
		expect( warning ).toHaveBeenCalledWith( 'performance report: closed' );

	} finally { warning.mockRestore(); }

} );
