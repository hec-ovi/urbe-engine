import { describe, expect, it } from 'vitest';
import { availableParallelism } from 'node:os';
import { defaultWorkers, maxTemperature, DEFAULT_MAX_TEMP, MARGIN, MAX_TEMP_ENV, WORKERS_ENV } from './Parallelism.js';
import { ThermalGovernor, cpuTemperature, throttlePoint } from './ThermalGovernor.js';
import { parseCityArgs } from './CityPlan.js';

describe( 'batch parallelism', () => {

	it( 'opens a quarter of the machine, takes an exact count from the environment and ignores an unusable one', () => {

		const quarter = Math.max( 1, Math.floor( availableParallelism() / 4 ) );

		expect( defaultWorkers( {} ) ).toBe( quarter );
		expect( parseCityArgs( [ '--blueprint', 'city.json', '--out', 'world' ] ).workers ).toBe( quarter );
		expect( defaultWorkers( { [ WORKERS_ENV ]: '6' } ) ).toBe( 6 );
		for ( const value of [ '0', '-2', '2.5', 'many', '' ] ) expect( defaultWorkers( { [ WORKERS_ENV ]: value } ) ).toBe( quarter );

		// The ceiling is on by default, sits under the die's published throttle
		// point where there is one, and takes the environment's own over both.
		expect( maxTemperature( {} ) ).toBe( DEFAULT_MAX_TEMP );
		expect( maxTemperature( {}, 100 ) ).toBe( 100 - MARGIN );
		expect( maxTemperature( { [ MAX_TEMP_ENV ]: '70' }, 100 ) ).toBe( 70 );
		expect( maxTemperature( { [ MAX_TEMP_ENV ]: '0' } ) ).toBe( 0 );
		expect( maxTemperature( { [ MAX_TEMP_ENV ]: 'hot' } ) ).toBe( DEFAULT_MAX_TEMP );

	} );

	it( 'narrows on a held reading, ignores a spike, never goes serial and holds full width without a ceiling', () => {

		const readings = [ 85, 85, 85, 85, 70, 70, 70 ];
		const governor = new ThermalGovernor( 4, 80, () => readings.shift() );
		let now = 0;

		// The first samples of a run decide nothing: a held reading needs three.
		expect( governor.width( now ) ).toBe( 4 );
		expect( governor.width( now += 1000 ) ).toBe( 4 );
		expect( governor.width( now += 2000 ) ).toBe( 4 );
		expect( governor.width( now += 2000 ) ).toBe( 3 );
		expect( governor.width( now += 2000 ) ).toBe( 2 );
		// Two workers is the floor, whatever the machine reads.
		expect( governor.width( now += 2000 ) ).toBe( 2 );
		expect( governor.width( now += 2000 ) ).toBe( 3 );
		expect( governor.width( now += 2000 ) ).toBe( 4 );
		expect( governor.summary() ).toMatch( /held under 80 C, narrowed 2 times, 4 of 4/ );

		// One boosted core between two ordinary readings is not a temperature.
		const spike = [ 70, 98, 70 ];
		const spiking = new ThermalGovernor( 4, 80, () => spike.shift() );
		let held = 0;
		for ( let at = 0; at < 3; at ++ ) held = spiking.width( at * 2000 );
		expect( held ).toBe( 4 );
		expect( spiking.summary() ).toMatch( /narrowed 0 times/ );

		expect( new ThermalGovernor( 6, 0, () => 99 ).width() ).toBe( 6 );
		const blind = new ThermalGovernor( 6, 80, () => null );
		expect( blind.width( 0 ) ).toBe( 6 );
		expect( blind.summary() ).toMatch( /held under 80 C/ );

	} );

	it( 'follows the die and reads the chassis probe only where no die sensor exists', () => {

		const die = { name: 'k10temp', values: [ 78, 80 ], limits: [] };
		const chassis = { name: 'acpitz', values: [ 91 ], limits: [ 110 ] };

		expect( cpuTemperature( [ chassis, die ] ) ).toBe( 80 );
		expect( cpuTemperature( [ { name: 'coretemp', values: [ 71 ], limits: [] }, chassis ] ) ).toBe( 71 );
		expect( cpuTemperature( [ chassis ] ) ).toBe( 91 );
		expect( cpuTemperature( [] ) ).toBe( null );

		// The throttle point is the die's own, never the chassis probe's.
		expect( throttlePoint( [ chassis, die ] ) ).toBe( null );
		expect( throttlePoint( [ chassis, { name: 'coretemp', values: [ 71 ], limits: [ 100, 105 ] } ] ) ).toBe( 100 );

	} );

} );
