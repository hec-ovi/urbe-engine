import { describe, expect, it } from 'vitest';
import { DEFAULT_TYPE_SET, FIXTURE_BLUEPRINT, FIXTURE_INTERIORS, FIXTURE_THEMED_TYPES } from '../../../../simulation/dist/index.js';
import { SimBridge } from './SimBridge.js';

const buildings = new Map( Object.entries( FIXTURE_INTERIORS ).map( ( [ id, npc ] ) => [ id, { npc } ] ) );

/**
 * A named world comes with its own people: the naming box's typed set says
 * who lives and works in this city, and the population has to be made of
 * those types, not the library's generic ones.
 */
describe( 'SimBridge', () => {

	it( 'peoples the city with the typed set the world carries', () => {

		const themed = {
			...DEFAULT_TYPE_SET,
			types: DEFAULT_TYPE_SET.types.map( ( type ) =>
				type.type === 'shop_clerk' ? { ...type, type: 'dock_hawker', label: 'dock hawker' } : type )
		};

		const sim = SimBridge.create( FIXTURE_BLUEPRINT, { networks: undefined }, buildings, {}, themed );
		const types = Object.keys( sim.simulation.populationStats().typeCounts );

		expect( types ).toContain( 'dock_hawker' );
		expect( types ).not.toContain( 'shop_clerk' );

	} );

	it( 'falls back to the built-in set when the world carries none', () => {

		const sim = SimBridge.create( FIXTURE_BLUEPRINT, { networks: undefined }, buildings );

		expect( Object.keys( sim.simulation.populationStats().typeCounts ) ).toContain( 'shop_clerk' );

	} );

	it( 'keeps an interior waiter in the vendor vocabulary', () => {

		const sim = SimBridge.create( FIXTURE_BLUEPRINT, { networks: undefined }, buildings, {}, FIXTURE_THEMED_TYPES );
		const waiter = sim.getNPCVendor( { parcelId: 'p_rest', role: 'waiter', timeMin: 12 * 60 } );
		const type = FIXTURE_THEMED_TYPES.types.find( ( candidate ) => candidate.type === waiter.type );

		expect( waiter.job.role ).toBe( 'waiter' );
		expect( type.category ).toBe( 'vendor' );
		expect( waiter.type ).not.toBe( 'harbour_crane_operator' );

	} );

	it( 'preserves closed simulation errors for continuity control', () => {

		const sim = SimBridge.create( FIXTURE_BLUEPRINT, { networks: undefined }, buildings );
		expect( errorCode( () => sim.interrupt( 'missing', 0 ) ) ).toBe( 'E_UNKNOWN_ID' );
		expect( errorCode( () => sim.continuityAt( 'missing', 0 ) ) ).toBe( 'E_UNKNOWN_ID' );

	} );

} );

function errorCode( run ) {

	try { run(); return null; }
	catch ( error ) { return error.code; }

}
