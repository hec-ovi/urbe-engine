import { describe, it, expect } from 'vitest';
import { CityGenerator } from './CityGenerator.js';
import { ARCHETYPES } from './archetypes.js';

describe( 'CityGenerator', () => {

	it( 'same seed and count produce an identical city', () => {

		const a = new CityGenerator( 1337 ).generate( 5000 );
		const b = new CityGenerator( 1337 ).generate( 5000 );
		expect( a ).toEqual( b );

	} );

	it( 'a different seed produces a different city', () => {

		const a = new CityGenerator( 1337 ).generate( 1000 );
		const b = new CityGenerator( 42 ).generate( 1000 );
		expect( a ).not.toEqual( b );

	} );

	it( 'places exactly count buildings, each inside bounds and its archetype ranges', () => {

		const { buildings, halfExtent } = new CityGenerator( 7 ).generate( 2500 );
		expect( buildings.length ).toBe( 2500 );

		for ( const b of buildings ) {

			const def = ARCHETYPES[ b.archetype ];
			expect( def ).toBeDefined();
			expect( Math.abs( b.x ) ).toBeLessThanOrEqual( halfExtent );
			expect( Math.abs( b.z ) ).toBeLessThanOrEqual( halfExtent );
			expect( b.sx ).toBeGreaterThanOrEqual( def.footprint[ 0 ] );
			expect( b.sx ).toBeLessThanOrEqual( def.footprint[ 1 ] );
			expect( b.sy ).toBeGreaterThanOrEqual( def.height[ 0 ] );
			expect( b.sy ).toBeLessThanOrEqual( def.height[ 1 ] );

		}

	} );

} );
