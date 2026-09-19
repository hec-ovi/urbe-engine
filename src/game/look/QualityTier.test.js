import { describe, expect, it } from 'vitest';
import { QualityTier } from './QualityTier.js';

/**
 * The tier is the one place the backend is allowed to matter. Everything
 * downstream reads the descriptor, so what has to hold is that a backend picks
 * a sane default, a named tier always wins, and `low` still carries the things
 * the whole look is made of.
 */
describe( 'QualityTier', () => {

	it( 'lets the backend choose only when the run does not, and keeps the look at every tier', () => {

		expect( QualityTier.describe( null, 'webgpu' ).name ).toBe( 'high' );
		expect( QualityTier.describe( null, 'webgl' ).name ).toBe( 'low' );
		expect( QualityTier.describe( 'ultra', 'webgl' ).name ).toBe( 'ultra' );
		expect( QualityTier.describe( 'nonsense', 'webgpu' ).name ).toBe( 'high' );


		const low = QualityTier.describe( 'low', 'webgl' );
		const ultra = QualityTier.describe( 'ultra', 'webgpu' );

		// low is the fallback backend's tier: no bloom chain, but a room fill is on; haze quads are off on every tier.
		expect( low.bloom.strength ).toBe( 0 );
		expect( low.haze ).toBe( false );
		// Enough slots that one live floor's rooms are lit from their own fixtures.
		expect( low.roomSlots ).toBe( QualityTier.describe( 'medium' ).roomSlots );
		for ( const name of QualityTier.names() ) expect( QualityTier.describe( name ).materialMaps )
			.toEqual( [ 'basecolor', 'normal', 'roughness', 'metallic', 'ao', 'emission' ] );
		expect( low.textureMaxSize ).toBe( 1024 );
		expect( low.textureMaxSize ).toBeLessThan( ultra.textureMaxSize );
		expect( low.textureAnisotropy ).toBeLessThan( ultra.textureAnisotropy );
		expect( low.probeSize ).toBe( 32 );

		expect( ultra.roomSlots ).toBeGreaterThan( low.roomSlots );
		expect( ultra.probeSize ).toBeGreaterThan( low.probeSize );

	} );

} );
