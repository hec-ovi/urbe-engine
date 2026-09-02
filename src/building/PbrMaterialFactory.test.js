// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { PbrMaterialFactory } from './PbrMaterialFactory.js';

const entry = ( emissiveStrength ) => ( {
	alignment: 'tile',
	tiling: { worldSize: [ 1, 1 ] },
	physical: { emissiveStrength, roughnessFactor: 1, metallicFactor: 0 },
	variants: [ { id: 'lamp', maps: { basecolor: 'a.png', emission: 'e.png' } } ]
} );

const factoryFor = ( strength ) => new PbrMaterialFactory( {
	resolve: ( key ) => ( key.startsWith( 'known' ) ? entry( strength ) : null ),
	mapUrl: ( theme, path ) => `/materials/${theme}/${path}`
} );

/**
 * The look is graded against how bright a lamp lens reads on screen. That level
 * has to survive a materials release re-authoring the map's own strength, which
 * is exactly what happened when the light-fixture family went from 3 to 1.2 and
 * every fixture in the city would otherwise have gone dim.
 */
describe( 'PbrMaterialFactory', () => {

	it( 'takes the emissive level as authored, whatever the database says', () => {

		const bright = factoryFor( 3 ).variant( 'known/light-fixture/mid', { emissiveLevel: 180 } );
		const dim = factoryFor( 1.2 ).variant( 'known/light-fixture/mid', { emissiveLevel: 180 } );

		expect( bright.emissiveIntensity ).toBe( 180 );
		expect( dim.emissiveIntensity ).toBe( 180 );

	} );

	it( 'still rides the database strength where a scale is asked for', () => {

		expect( factoryFor( 2.5 ).variant( 'known/signage/mid', { emissiveScale: 26 } ).emissiveIntensity ).toBe( 65 );
		expect( factoryFor( 5 ).variant( 'known/signage/mid', { emissiveScale: 26 } ).emissiveIntensity ).toBe( 130 );

	} );

	it( 'gives a key the database cannot serve the unmistakable fallback', () => {

		const material = factoryFor( 3 ).build( 'unknown/brand/none' );

		expect( material.name ).toBe( 'unresolved:unknown/brand/none' );
		expect( material.color.getHex() ).toBe( 0xff00ff );

	} );

} );
