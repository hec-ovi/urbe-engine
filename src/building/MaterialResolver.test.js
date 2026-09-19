import { describe, expect, it, vi } from 'vitest';
import { MaterialResolver } from './MaterialResolver.js';

const INDEX = {
	entries: {
		'cyberpunk/wall/mid': { alignment: 'tile', variants: [ { id: 'plain' }, { id: 'panel' } ] },
		'cyberpunk/ad-screen/mid': {
			alignment: 'exact', variants: [ { id: 'brand:sample' } ], aliases: [ 'cyberpunk/screen/mid' ]
		}
	}
};

/**
 * A world can name a brand whose assets are not on this machine, so an
 * unanswerable key comes back as nothing instead of throwing, and the run can
 * count what resolved without building the lists every frame.
 */
describe( 'MaterialResolver', () => {

	it( 'resolves keys and aliases, answers nothing for what it cannot serve, and publishes both surfaces', async () => {

		vi.stubGlobal( 'fetch', async ( url ) => ( {
			ok: true,
			json: async () => url.endsWith( '/bindings/atlas-hydrology.json' )
				? { 'water.river': { key: 'cyberpunk/water-surface/high_rich', variantId: 'river' } }
				: INDEX
		} ) );
		const resolver = new MaterialResolver();
		await resolver.loadTheme( 'cyberpunk' );

		expect( resolver.resolve( 'cyberpunk/wall/mid' ) ).toBe( INDEX.entries[ 'cyberpunk/wall/mid' ] );
		expect( resolver.resolve( 'cyberpunk/screen/mid' ) ).toBe( INDEX.entries[ 'cyberpunk/ad-screen/mid' ] );
		expect( resolver.resolve( 'cyberpunk/ad-screen/mid#brand:kirin-noodles' ) ).toBe( null );
		expect( resolver.resolve( 'nosuchtheme/wall/mid' ) ).toBe( null );
		expect( resolver.counts ).toEqual( { resolved: 2, unresolved: 2, unknownVariants: 0 } );
		expect( resolver.report().unresolved ).toEqual( [
			'cyberpunk/ad-screen/mid#brand:kirin-noodles', 'nosuchtheme/wall/mid'
		] );
		expect( resolver.mapUrl( 'cyberpunk', 'wall/plain.png' ) ).toBe( '/materials/cyberpunk/wall/plain.png' );

		await expect( resolver.loadBindings( 'atlas-hydrology' ) ).resolves.toEqual( {
			'water.river': { key: 'cyberpunk/water-surface/high_rich', variantId: 'river' }
		} );
		await expect( resolver.loadBindings( '../other' ) ).rejects.toThrow( 'invalid material binding name' );

		expect( resolver.missionCatalog( 'cyberpunk' ) ).toEqual( {
			contractVersion: '1.0',
			entries: [
				{ key: 'cyberpunk/ad-screen/mid', aliases: [ 'cyberpunk/screen/mid' ], variants: [ 'brand:sample' ] },
				{ key: 'cyberpunk/wall/mid', variants: [ 'plain', 'panel' ] }
			]
		} );
		expect( () => resolver.missionCatalog( 'absent' ) ).toThrow( 'theme index absent is not loaded' );
		vi.unstubAllGlobals();

	} );

} );
