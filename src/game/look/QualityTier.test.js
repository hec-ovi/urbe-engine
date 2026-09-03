import { describe, expect, it } from 'vitest';
import { QualityTier } from './QualityTier.js';

/**
 * The tier is the one place the backend is allowed to matter. Everything
 * downstream reads the descriptor, so what has to hold is that a backend picks
 * a sane default, a named tier always wins, and `low` still carries the things
 * the whole look is made of.
 */
describe( 'QualityTier', () => {

	it( 'lets the backend choose only when the run does not', () => {

		expect( QualityTier.describe( null, 'webgpu' ).name ).toBe( 'high' );
		expect( QualityTier.describe( null, 'webgl' ).name ).toBe( 'low' );
		expect( QualityTier.describe( 'ultra', 'webgl' ).name ).toBe( 'ultra' );
		expect( QualityTier.describe( 'nonsense', 'webgpu' ).name ).toBe( 'high' );

	} );

	it( 'keeps the look at every tier and spends more at the top', () => {

		const low = QualityTier.describe( 'low', 'webgl' );
		const ultra = QualityTier.describe( 'ultra', 'webgpu' );

		// low is the fallback backend's tier: no bloom chain, but a room fill is on; haze quads are off on every tier.
		expect( low.bloom.strength ).toBe( 0 );
		expect( low.haze ).toBe( false );
		expect( low.roomSlots ).toBeGreaterThan( 0 );
		expect( low.materialMaps ).toEqual( [ 'basecolor', 'normal', 'emission' ] );
		expect( low.materialVariants ).toBeLessThan( ultra.materialVariants );
		expect( low.textureAnisotropy ).toBeLessThan( ultra.textureAnisotropy );
		expect( low.probeSize ).toBe( 0 );

		expect( ultra.roomSlots ).toBeGreaterThan( low.roomSlots );
		expect( ultra.probeSize ).toBeGreaterThan( low.probeSize );

	} );

} );
