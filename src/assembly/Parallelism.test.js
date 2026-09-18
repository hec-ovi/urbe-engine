import { describe, expect, it } from 'vitest';
import { availableParallelism } from 'node:os';
import { defaultWorkers, maxTemperature, DEFAULT_MAX_TEMP, MAX_TEMP_ENV, WORKERS_ENV } from './Parallelism.js';
import { parseCityArgs } from './CityPlan.js';

describe( 'batch parallelism', () => {

	it( 'opens a quarter of the machine by default', () => {

		const expected = Math.max( 1, Math.floor( availableParallelism() / 4 ) );
		expect( defaultWorkers( {} ) ).toBe( expected );
		expect( parseCityArgs( [ '--blueprint', 'city.json', '--out', 'world' ] ).workers ).toBe( expected );

	} );

	it( 'takes an exact count from the environment and ignores an unusable one', () => {

		expect( defaultWorkers( { [ WORKERS_ENV ]: '6' } ) ).toBe( 6 );
		for ( const value of [ '0', '-2', '2.5', 'many', '' ] ) {

			expect( defaultWorkers( { [ WORKERS_ENV ]: value } ) ).toBe( Math.max( 1, Math.floor( availableParallelism() / 4 ) ) );

		}

	} );

	it( 'throttles on temperature only when the environment sets a ceiling', () => {

		expect( maxTemperature( {} ) ).toBe( DEFAULT_MAX_TEMP );
		expect( maxTemperature( { [ MAX_TEMP_ENV ]: '70' } ) ).toBe( 70 );
		expect( maxTemperature( { [ MAX_TEMP_ENV ]: '0' } ) ).toBe( 0 );
		expect( maxTemperature( { [ MAX_TEMP_ENV ]: 'hot' } ) ).toBe( DEFAULT_MAX_TEMP );

	} );

} );
