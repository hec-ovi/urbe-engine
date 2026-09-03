import { describe, expect, it } from 'vitest';
import { brandVariant, screenVariant } from './Neon.js';

/**
 * A named business's screens resolve to the variant the materials box spelled
 * for it, so the slug here has to match its rule exactly or every branded ad
 * silently falls back to the brandless art.
 */
describe( 'brandVariant', () => {

	it( 'spells the materials box variant id for a business name', () => {

		expect( brandVariant( "Kiro's Clinic" ) ).toBe( 'brand:kiro-s-clinic' );
		expect( brandVariant( 'The Grand Meridian Hotel' ) ).toBe( 'brand:the-grand-meridian-hotel' );
		expect( brandVariant( 'NOODLE 9' ) ).toBe( 'brand:noodle-9' );

	} );

	it( 'gives no variant for a name with nothing to spell', () => {

		expect( brandVariant( '???' ) ).toBe( null );

	} );

} );

describe( 'screenVariant', () => {

	it( 'uses the named future-noir variants, never removed numeric ids', () => {

		expect( screenVariant( 'poor' ) ).toEqual( {
			key: 'cyberpunk/ad-screen/poor', variantId: 'noir-cyan'
		} );
		expect( screenVariant( 'high_rich' ) ).toEqual( {
			key: 'cyberpunk/ad-screen/high_rich', variantId: 'noir-amber'
		} );
		expect( screenVariant( 'rich', 'brand:kiro-s-clinic' ) ).toEqual( {
			key: 'cyberpunk/ad-screen/rich', variantId: 'brand:kiro-s-clinic'
		} );

	} );

	it( 'fails closed on a tier outside the materials contract', () => {

		expect( () => screenVariant( 'unknown' ) ).toThrow( /no canonical ad-screen variant/ );

	} );

} );
