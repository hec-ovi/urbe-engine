import { describe, expect, it } from 'vitest';
import { manifestFor, questBundle, selectQuestBundle, QuestBundleError } from './index.js';

describe( 'quest handoff bundle', () => {

	it( 'validates and selects every referenced catalog as one unit', () => {

		const catalogs = fixture();
		const all = questBundle( manifestFor( catalogs, 'all.questlines.json' ), catalogs );
		const selected = selectQuestBundle( all, [ 'main' ] );

		expect( selected.manifest ).toMatchObject( {
			contractVersion: '1.1',
			files: { questlines: 'questlines.json' },
			counts: {
				questlines: 1, objectives: 1, investigations: 0, mechanicTargetBindings: 0,
				missionAssetRequests: 1, missionItemBindings: 1
			}
		} );
		expect( selected.questlines.map( ( value ) => value.id ) ).toEqual( [ 'main' ] );
		expect( selected.missionAssetRequests.map( ( value ) => value.assetId ) ).toEqual( [ 'asset.main' ] );

	} );

	it( 'keeps fixed target assets and validates target, interaction and host capability references', () => {

		const catalogs = fixedFixture();
		const all = questBundle( manifestFor( catalogs ), catalogs );
		const selected = selectQuestBundle( all, [ 'fixed' ] );

		expect( selected.mechanicTargetBindings ).toEqual( [ catalogs.mechanicTargetBindings[ 0 ] ] );
		expect( selected.missionAssetRequests.map( ( request ) => request.assetId ) ).toEqual( [ 'console.fixed' ] );
		expect( selected.hostCapabilities ).toEqual( { transportationModes: [ 'public-transit' ] } );

		expect( () => questBundle( manifestFor( catalogs ), {
			...catalogs,
			mechanicTargetBindings: [ { ...catalogs.mechanicTargetBindings[ 0 ], interactionId: 'sabotage' } ]
		} ) ).toThrowError( /disagrees/ );
		expect( () => questBundle( manifestFor( catalogs ), {
			...catalogs, hostCapabilities: { transportationModes: [] }
		} ) ).toThrowError( /unsupported mode public-transit/ );

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
		mechanicTargetBindings: [],
		missionAssetRequests: [ { assetId: 'asset.main' }, { assetId: 'asset.side' } ],
		missionItemBindings: [
			{ questId: 'main', itemId: 'item', assetId: 'asset.main' },
			{ questId: 'side', itemId: 'item', assetId: 'asset.side' }
		],
		hostCapabilities: { transportationModes: [] }
	};

}

function fixedFixture() {

	const fixed = {
		id: 'fixed', items: [], steps: [
			{ stepId: 'hack', target: { kind: 'hacking', targetId: 'terminal', place: { parcelId: 'p1' } } },
			{
				stepId: 'ride', target: {
					kind: 'transportation', journeyId: 'j1', mode: 'public-transit',
					from: { parcelId: 'p1' }, to: { parcelId: 'p2' }, passengerRoleIds: [], cargoItemIds: []
				}
			}
		]
	};
	const spare = definition( 'spare' );
	const questlines = [ fixed, spare ];
	return {
		questlines,
		objectives: questlines.flatMap( ( value ) => value.steps.map( ( step ) => ( {
			questId: value.id, stepId: step.stepId, action: step.target
		} ) ) ),
		investigations: [],
		mechanicTargetBindings: [
			{ questId: 'fixed', stepId: 'hack', targetId: 'terminal', assetId: 'console.fixed', interactionId: 'hack' }
		],
		missionAssetRequests: [
			{ assetId: 'console.fixed', requiredInteractions: [ 'hack' ] },
			{ assetId: 'asset.spare' }
		],
		missionItemBindings: [ { questId: 'spare', itemId: 'item', assetId: 'asset.spare' } ],
		hostCapabilities: { transportationModes: [ 'public-transit' ] }
	};

}

function definition( id ) {

	return {
		id, items: [ { itemId: 'item' } ],
		steps: [ { stepId: 'step', target: { kind: 'pickup', itemId: 'item' } } ]
	};

}
