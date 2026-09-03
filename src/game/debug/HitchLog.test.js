import { afterEach, describe, expect, it, vi } from 'vitest';
import { HitchLog } from './HitchLog.js';

/**
 * The log is what turns "the game feels slow" into a named cause. It has to
 * ignore a frame that was merely slow, print what the world did during a frame
 * that froze, say so when the world did nothing, and keep the run's own tally
 * so the HUD can answer "did it stall" without a console open.
 */
describe( 'HitchLog', () => {

	afterEach( () => vi.restoreAllMocks() );

	const listen = () => vi.spyOn( console, 'info' ).mockImplementation( () => {} );

	it( 'says nothing about a frame inside the threshold', () => {

		const info = listen();
		const log = new HitchLog( 40 );

		log.note( 'floor p0:0 collider', 4 );
		log.frame( 22 );

		expect( info ).not.toHaveBeenCalled();
		expect( log.count ).toBe( 0 );
		expect( log.worst ).toBe( 0 );

	} );

	it( 'prints what the world did during a freeze, with its cost', () => {

		const info = listen();
		const log = new HitchLog( 40 );

		log.note( 'floor p36:1 warm', 61.4 );
		log.note( '3 shaders linked' );
		log.frame( 512 );

		expect( info ).toHaveBeenCalledWith( 'hitch 512 ms: floor p36:1 warm 61 ms, 3 shaders linked' );

	} );

	it( 'names a freeze the world did not cause, and keeps the tally', () => {

		const info = listen();
		const log = new HitchLog( 40 );

		log.frame( 90 );
		log.frame( 8754 );
		log.frame( 10 );

		expect( info ).toHaveBeenLastCalledWith( 'hitch 8754 ms: no world event in this gap' );
		expect( log.count ).toBe( 2 );
		expect( log.worst ).toBe( 8754 );

	} );

	it( 'clears its notes with every frame, so a gap only carries its own', () => {

		const info = listen();
		const log = new HitchLog( 40 );

		log.note( 'band p0:0 collider', 9 );
		log.frame( 10 );
		log.frame( 300 );

		expect( info ).toHaveBeenCalledWith( 'hitch 300 ms: no world event in this gap' );

	} );

	it( 'times dominant synchronous frame work without logging normal work', () => {

		const log = new HitchLog();
		const clock = vi.spyOn( performance, 'now' )
			.mockReturnValueOnce( 10 ).mockReturnValueOnce( 22 )
			.mockReturnValueOnce( 30 ).mockReturnValueOnce( 32 );

		expect( log.time( 'render', () => 'done' ) ).toBe( 'done' );
		log.time( 'agents', () => {} );

		expect( log.notes ).toEqual( [ 'render 12 ms' ] );
		clock.mockRestore();

	} );

} );
