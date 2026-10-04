import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { FrameReports } from './FrameReports.js';
import { hitchReportPlugin } from './hitchReportPlugin.js';
import { HitchLog } from './HitchLog.js';
import { GlTimes } from './GlTimes.js';

const snapshot = () => ( { game: 'review', stats: { gpuMs: 7 }, memory: { textures: 4 }, position: [ 1, 2, 3 ] } );

it( 'sends bounded gap reports once per second, collects scene counters only then, and survives a failed send', () => {

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
	// The snapshot is told how many frames the report covers, to give its own counters per frame.
	expect( collect.mock.calls.map( ( [ frames ] ) => frames ) ).toEqual( [ 26, 1 ] );

	const warning = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
	const failing = new FrameReports( () => { throw new Error( 'closed' ); }, snapshot );
	expect( () => failing.frame( 1000, 60, [] ) ).not.toThrow();
	expect( warning ).toHaveBeenCalledWith( 'performance report: closed' );
	warning.mockRestore();

} );

it( 'writes schema-valid development events to local storage and discards malformed ones', async () => {

	const directory = await mkdtemp( join( tmpdir(), 'game-reports-' ) );
	try {

		const ws = new EventEmitter();
		hitchReportPlugin( directory ).configureServer( { ws, config: { logger: { warn: vi.fn() } } } );
		ws.emit( 'urbe:performance', { unwanted: true } );
		const reports = new FrameReports( report => ws.emit( 'urbe:performance', report ), snapshot );
		const profiled = new FrameReports( report => ws.emit( 'urbe:performance', report ), () => ( {
			...snapshot(), profile: { sections: { render: 12.5 }, gl: { drawElements: { ms: 3.2, calls: 400 } }, scene: { objects: 9000 } }
		} ) );
		profiled.frame( 1000, 30, [] );
		reports.frame( 1000, 85, [ 'physics/player 5 ms', 'render 70 ms' ] );
		await vi.waitFor( async () => {

			const stored = JSON.parse( await readFile( join( directory, 'performance.json' ) ) );
			expect( stored ).toHaveLength( 2 );
			expect( stored[ 0 ].profile.gl.drawElements ).toEqual( { ms: 3.2, calls: 400 } );
			expect( stored[ 1 ].frames.worst ).toBe( 85 );
			expect( stored[ 1 ].hitches[ 0 ].notes ).toContain( 'render 70 ms' );

		} );

	} finally { await rm( directory, { recursive: true, force: true } ); }

} );

it( 'adds up what each timed step took, however small, and hands it out per frame', () => {

	const log = new HitchLog();
	for ( let frame = 0; frame < 4; frame ++ ) log.time( 'crowd', () => {} );
	log.spent.set( 'render', 80 );
	expect( log.drainSpent( 4 ) ).toEqual( { crowd: expect.any( Number ), render: 20 } );
	expect( log.notes ).toEqual( [] );
	expect( log.drainSpent( 4 ) ).toEqual( {} );

} );

it( 'times the WebGL calls that can hold the thread, the multi-draw extension\'s too, per frame', () => {

	const multi = { multiDrawElementsWEBGL: vi.fn() };
	const gl = { drawElements: vi.fn(), bufferSubData: vi.fn(), getExtension: vi.fn( () => multi ) };
	const times = new GlTimes( gl );
	for ( let i = 0; i < 6; i ++ ) gl.drawElements( 4, 3, 5123, 0 );
	gl.getExtension( 'WEBGL_multi_draw' ).multiDrawElementsWEBGL( 4, [], 0, 5123, [], 0, 0 );
	const drained = times.drain( 2 );
	expect( drained.drawElements.calls ).toBe( 3 );
	expect( drained.multiDrawElementsWEBGL.calls ).toBe( 0.5 );
	expect( drained.bufferSubData ).toBeUndefined();
	expect( times.drain( 2 ) ).toEqual( {} );

} );
