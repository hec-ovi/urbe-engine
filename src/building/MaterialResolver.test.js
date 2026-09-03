import { beforeEach, describe, expect, it, vi } from 'vitest';
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
 * A world can name a brand whose assets are not on this machine, so the two
 * promises that matter are that an unanswerable key comes back as nothing
 * instead of throwing, and that the run can count what resolved without
 * building the lists every frame.
 */
describe( 'MaterialResolver', () => {

	let resolver;

	beforeEach( async () => {

		vi.stubGlobal( 'fetch', async ( url ) => ( {
			ok: true,
			json: async () => url.endsWith( '/bindings/atlas-hydrology.json' )
				? { 'water.river': { key: 'cyberpunk/water-surface/high_rich', variantId: 'river' } }
				: INDEX
		} ) );
		resolver = new MaterialResolver();
		await resolver.loadTheme( 'cyberpunk' );

	} );

	it( 'loads an exact Materials-owned binding document', async () => {

		await expect( resolver.loadBindings( 'atlas-hydrology' ) ).resolves.toEqual( {
			'water.river': { key: 'cyberpunk/water-surface/high_rich', variantId: 'river' }
		} );
		await expect( resolver.loadBindings( '../other' ) ).rejects.toThrow( 'invalid material binding name' );

	} );

	it( 'resolves a key and its aliases', () => {

		expect( resolver.resolve( 'cyberpunk/wall/mid' ) ).toBe( INDEX.entries[ 'cyberpunk/wall/mid' ] );
		expect( resolver.resolve( 'cyberpunk/screen/mid' ) ).toBe( INDEX.entries[ 'cyberpunk/ad-screen/mid' ] );

	} );

	it( 'answers nothing for a key the database cannot serve, and names it', () => {

		expect( resolver.resolve( 'cyberpunk/ad-screen/mid#brand:kirin-noodles' ) ).toBe( null );
		expect( resolver.resolve( 'nosuchtheme/wall/mid' ) ).toBe( null );

		expect( resolver.report().unresolved ).toEqual( [
			'cyberpunk/ad-screen/mid#brand:kirin-noodles', 'nosuchtheme/wall/mid'
		] );

	} );

	it( 'counts both sides without building the lists', () => {

		resolver.resolve( 'cyberpunk/wall/mid' );
		resolver.resolve( 'cyberpunk/wall/mid' );
		resolver.resolve( 'cyberpunk/brand/none' );

		expect( resolver.counts ).toEqual( { resolved: 1, unresolved: 1 } );

	} );

	it( 'publishes the loaded key, alias and variant surface for mission asset creation', () => {

		expect( resolver.missionCatalog( 'cyberpunk' ) ).toEqual( {
			contractVersion: '1.0',
			entries: [
				{ key: 'cyberpunk/ad-screen/mid', aliases: [ 'cyberpunk/screen/mid' ], variants: [ 'brand:sample' ] },
				{ key: 'cyberpunk/wall/mid', variants: [ 'plain', 'panel' ] }
			]
		} );
		expect( () => resolver.missionCatalog( 'absent' ) ).toThrow( 'theme index absent is not loaded' );

	} );

} );
