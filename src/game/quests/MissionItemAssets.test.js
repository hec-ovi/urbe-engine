import { describe, expect, it } from 'vitest';
import { MissionItemAssets } from './MissionItemAssets.js';

const catalog = {
	contractVersion: '1.0',
	entries: [ { key: 'cyberpunk/fabric/mid', variants: [ 'flat' ] } ]
};
const request = {
	contractVersion: '1.0', assetId: 'asset.case-file', purpose: 'Case file', family: 'document',
	dimensions: { width: 0.24, height: 0.018, depth: 0.32 },
	materials: [ { slot: 'surface', key: 'cyberpunk/fabric/mid', variantId: 'flat' } ],
	requiredInteractions: [ 'inspect', 'read', 'take' ],
	clearance: { approachDepth: 1, sideMargin: 0.3, overhead: 0.2 }, seed: 8
};

describe( 'mission item asset binding', () => {

	it( 'creates the exact request and resolves only its authored quest and item pair', () => {

		const assets = new MissionItemAssets( {
			requests: [ request ],
			bindings: [ { questId: 'quest.case', itemId: 'item.file', assetId: request.assetId } ],
			materialCatalog: catalog
		} );

		expect( assets.get( 'quest.case', 'item.file' ) ).toMatchObject( {
			assetId: request.assetId, dimensions: request.dimensions, portable: true
		} );
		expect( assets.get( 'quest.other', 'item.file' ) ).toBe( null );
		expect( assets.get( 'quest.case', 'item.other' ) ).toBe( null );

	} );

	it( 'fails before play when a material or bound asset does not exist', () => {

		expect( () => new MissionItemAssets( {
			requests: [ { ...request, materials: [ { ...request.materials[ 0 ], variantId: 'missing' } ] } ],
			bindings: [], materialCatalog: catalog
		} ) ).toThrow( expect.objectContaining( { code: 'E_MATERIAL' } ) );
		expect( () => new MissionItemAssets( {
			requests: [], bindings: [ { questId: 'q', itemId: 'i', assetId: 'asset.missing' } ], materialCatalog: catalog
		} ) ).toThrow( expect.objectContaining( { code: 'E_NOT_FOUND' } ) );

	} );

} );
