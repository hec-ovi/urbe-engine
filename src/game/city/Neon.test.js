import { describe, expect, it } from 'vitest';
import { brandVariant } from './Neon.js';

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
