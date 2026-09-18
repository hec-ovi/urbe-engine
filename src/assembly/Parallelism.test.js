import { describe, expect, it } from 'vitest';
import { availableParallelism } from 'node:os';
import { defaultWorkers, maxTemperature, DEFAULT_MAX_TEMP, MAX_TEMP_ENV, WORKERS_ENV } from './Parallelism.js';
import { ThermalGovernor } from './ThermalGovernor.js';
import { parseCityArgs } from './CityPlan.js';

describe( 'batch parallelism', () => {

	it( 'opens a quarter of the machine, takes an exact count from the environment and ignores an unusable one', () => {

		const quarter = Math.max( 1, Math.floor( availableParallelism() / 4 ) );

		expect( defaultWorkers( {} ) ).toBe( quarter );
		expect( parseCityArgs( [ '--blueprint', 'city.json', '--out', 'world' ] ).workers ).toBe( quarter );
		expect( defaultWorkers( { [ WORKERS_ENV ]: '6' } ) ).toBe( 6 );
		for ( const value of [ '0', '-2', '2.5', 'many', '' ] ) expect( defaultWorkers( { [ WORKERS_ENV ]: value } ) ).toBe( quarter );

		expect( maxTemperature( {} ) ).toBe( DEFAULT_MAX_TEMP );
		expect( maxTemperature( { [ MAX_TEMP_ENV ]: '70' } ) ).toBe( 70 );
		expect( maxTemperature( { [ MAX_TEMP_ENV ]: 'hot' } ) ).toBe( DEFAULT_MAX_TEMP );

	} );

	it( 'narrows one worker every two seconds above the ceiling, widens once cooled and holds full width without one', () => {

		const readings = [ 85, 85, 70, 70 ];
		const governor = new ThermalGovernor( 4, 80, () => readings.shift() );
		let now = 0;

		expect( governor.width( now ) ).toBe( 3 );
		expect( governor.width( now += 1000 ) ).toBe( 3 );
		expect( governor.width( now += 2000 ) ).toBe( 2 );
		expect( governor.width( now += 2000 ) ).toBe( 3 );
		expect( governor.width( now += 2000 ) ).toBe( 4 );
		expect( governor.summary() ).toMatch( /narrowed 2 times, 4 of 4/ );

		expect( new ThermalGovernor( 6, 0, () => 99 ).width() ).toBe( 6 );
		const blind = new ThermalGovernor( 6, 80, () => null );
		expect( blind.width( 0 ) ).toBe( 6 );
		expect( blind.summary() ).toMatch( /held under 80 C/ );

	} );

} );
