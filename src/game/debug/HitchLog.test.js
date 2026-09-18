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

	it( 'prints only the gaps above its threshold, with the work of that gap alone, and keeps the tally', () => {

		const info = vi.spyOn( console, 'info' ).mockImplementation( () => {} );
		const log = new HitchLog( 40 );

		log.note( 'floor p0:0 collider', 4 );
		log.frame( 22 );

		expect( info ).not.toHaveBeenCalled();
		expect( log.count ).toBe( 0 );
		expect( log.worst ).toBe( 0 );

		log.note( 'floor p36:1 warm', 61.4 );
		log.note( '3 shaders linked' );
		log.frame( 512 );

		expect( info ).toHaveBeenCalledWith( 'hitch 512 ms: floor p36:1 warm 61 ms, 3 shaders linked' );

		log.frame( 8754 );

		expect( info ).toHaveBeenLastCalledWith( 'hitch 8754 ms: no world event in this gap' );
		expect( log.count ).toBe( 2 );
		expect( log.worst ).toBe( 8754 );

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
