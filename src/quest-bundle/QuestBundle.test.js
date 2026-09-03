import { describe, expect, it } from 'vitest';
import { manifestFor, questBundle, selectQuestBundle, QuestBundleError } from './index.js';

describe( 'quest handoff bundle', () => {

	it( 'validates and selects every referenced catalog as one unit', () => {

		const catalogs = fixture();
		const all = questBundle( manifestFor( catalogs, 'all.questlines.json' ), catalogs );
		const selected = selectQuestBundle( all, [ 'main' ] );

		expect( selected.manifest ).toMatchObject( {
			files: { questlines: 'questlines.json' },
			counts: { questlines: 1, objectives: 1, investigations: 0, missionAssetRequests: 1, missionItemBindings: 1 }
		} );
		expect( selected.questlines.map( ( value ) => value.id ) ).toEqual( [ 'main' ] );
		expect( selected.missionAssetRequests.map( ( value ) => value.assetId ) ).toEqual( [ 'asset.main' ] );

	} );

	it( 'fails closed for count, projection and cross-catalog disagreement', () => {

		const catalogs = fixture();
		expect( () => questBundle( { ...manifestFor( catalogs ), counts: { ...manifestFor( catalogs ).counts, objectives: 9 } }, catalogs ) )
			.toThrowError( expect.objectContaining( { code: 'E_QUEST_BUNDLE_COUNT' } ) );
		expect( () => questBundle( manifestFor( catalogs ), { ...catalogs, objectives: [ { ...catalogs.objectives[ 0 ], stepId: 'wrong' }, catalogs.objectives[ 1 ] ] } ) )
			.toThrowError( QuestBundleError );
		expect( () => questBundle( manifestFor( catalogs ), {
			...catalogs, missionItemBindings: [ { questId: 'main', itemId: 'item', assetId: 'missing' }, catalogs.missionItemBindings[ 1 ] ]
		} ) ).toThrowError( /unknown asset missing/ );

	} );

} );

function fixture() {

	const questlines = [ definition( 'main' ), definition( 'side' ) ];
	return {
		questlines,
		objectives: questlines.map( ( value ) => ( { questId: value.id, stepId: 'step', action: value.steps[ 0 ].target } ) ),
		investigations: [],
		missionAssetRequests: [ { assetId: 'asset.main' }, { assetId: 'asset.side' } ],
		missionItemBindings: [
			{ questId: 'main', itemId: 'item', assetId: 'asset.main' },
			{ questId: 'side', itemId: 'item', assetId: 'asset.side' }
		]
	};

}

function definition( id ) {

	return {
		id, items: [ { itemId: 'item' } ],
		steps: [ { stepId: 'step', target: { kind: 'pickup', itemId: 'item' } } ]
	};

}
