import { describe, expect, it } from 'vitest';
import { ThermalGovernor } from './ThermalGovernor.js';

describe( 'thermal governor', () => {

	it( 'narrows one worker per sample above the target and widens once cooled below it', () => {

		const readings = [ 85, 85, 70, 70 ];
		const governor = new ThermalGovernor( 4, 80, () => readings.shift() );
		let now = 0;
		expect( governor.width( now ) ).toBe( 3 );
		expect( governor.width( now += 1000 ) ).toBe( 3 );
		expect( governor.width( now += 2000 ) ).toBe( 2 );
		expect( governor.width( now += 2000 ) ).toBe( 3 );
		expect( governor.width( now += 2000 ) ).toBe( 4 );
		expect( governor.summary() ).toMatch( /narrowed 2 times, 4 of 4/ );

	} );

	it( 'leaves the batch at full width without a target or a sensor', () => {

		expect( new ThermalGovernor( 6, 0, () => 99 ).width() ).toBe( 6 );
		const blind = new ThermalGovernor( 6, 80, () => null );
		expect( blind.width( 0 ) ).toBe( 6 );
		expect( blind.summary() ).toMatch( /held under 80 C/ );

	} );

} );
