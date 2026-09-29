import { describe, expect, it } from 'vitest';
import { LoadProgress } from './LoadProgress.js';

describe( 'LoadProgress', () => {

	it( 'reports the loading line and its record: what runs, the step it runs under, the whole tally and a pass\'s own counter', () => {

		const reports = [];
		let now = 0;
		const progress = new LoadProgress( ( text, record ) => reports.push( [ text, record ] ), { now: () => now } );

		progress.plan( 3 ).step( 'reading the world' );
		expect( reports.at( - 1 ) ).toEqual( [ 'reading the world 0 / 3', { label: 'reading the world', step: 'reading the world', done: 0, total: 3, part: null } ] );

		now = 40;
		progress.step( 'laying the ground' );
		expect( reports.at( - 1 )[ 1 ] ).toEqual( { label: 'laying the ground', step: 'laying the ground', done: 1, total: 3, part: null } );

		// A pass declares its size as it learns it and counts against the whole load.
		const pass = progress.pass( 'baking the crowd' );
		pass.at( 2, 10 );
		expect( reports.at( - 1 ) ).toEqual( [ 'baking the crowd 3 / 13', { label: 'baking the crowd', step: 'laying the ground', done: 3, total: 13, part: { done: 2, total: 10 } } ] );
		pass.at( 10, 10 );
		expect( reports.at( - 1 )[ 1 ] ).toMatchObject( { done: 11, total: 13, part: { done: 10, total: 10 } } );

		// The tally never reads more done than planned.
		progress.advance( 5 );
		expect( reports.at( - 1 )[ 1 ] ).toMatchObject( { done: 13, total: 13 } );
		expect( progress.finish().map( ( [ label ] ) => label ) ).toEqual( [ 'reading the world', 'laying the ground' ] );

	} );

	it( 'reports a bare label while nothing is planned', () => {

		const reports = [];
		new LoadProgress( ( text, record ) => reports.push( [ text, record ] ) ).step( 'starting the renderer' );
		expect( reports ).toEqual( [ [ 'starting the renderer', { label: 'starting the renderer', step: 'starting the renderer', done: 0, total: 0, part: null } ] ] );

	} );

} );
