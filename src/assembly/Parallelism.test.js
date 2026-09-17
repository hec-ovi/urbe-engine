import { describe, expect, it } from 'vitest';
import { availableParallelism } from 'node:os';
import { defaultWorkers, WORKERS_ENV } from './Parallelism.js';
import { parseCityArgs } from './CityPlan.js';

describe( 'batch parallelism', () => {

	it( 'spreads a batch over the machine by default', () => {

		const expected = Math.max( 1, availableParallelism() - 1 );
		expect( defaultWorkers( {} ) ).toBe( expected );
		expect( parseCityArgs( [ '--blueprint', 'city.json', '--out', 'world' ] ).workers ).toBe( expected );

	} );

	it( 'takes an exact count from the environment and ignores an unusable one', () => {

		expect( defaultWorkers( { [ WORKERS_ENV ]: '6' } ) ).toBe( 6 );
		for ( const value of [ '0', '-2', '2.5', 'many', '' ] ) {

			expect( defaultWorkers( { [ WORKERS_ENV ]: value } ) ).toBe( Math.max( 1, availableParallelism() - 1 ) );

		}

	} );

} );
