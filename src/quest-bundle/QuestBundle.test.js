import { describe, expect, it } from 'vitest';
import { manifestFor, questBundle, questBundleFiles, selectQuestBundle, QuestBundleError } from './index.js';
import capabilities from '../game/scenery/capabilities.json' with { type: 'json' };

describe( 'quest handoff bundle', () => {

	it( 'validates and selects every referenced catalog as one unit', () => {

		const catalogs = fixture();
		const all = questBundle( manifestFor( catalogs, 'all.questlines.json' ), catalogs );
		const selected = selectQuestBundle( all, [ 'main' ] );

		expect( selected.manifest ).toMatchObject( {
			contractVersion: '1.2',
			files: { questlines: 'questlines.json', scenery: 'scenery.json' },
			counts: {
				questlines: 1, objectives: 1, investigations: 0, mechanicTargetBindings: 0,
				missionAssetRequests: 1, missionItemBindings: 1, scenery: 0
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
		scenery: [],
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
		scenery: [],
		hostCapabilities: { transportationModes: [ 'public-transit' ] }
	};

}

function definition( id ) {

	return {
		id, items: [ { itemId: 'item' } ], roles: [ { roleId: 'victim' } ], flags: [ 'found' ],
		steps: [ { stepId: 'step', target: { kind: 'pickup', itemId: 'item' } } ]
	};

}

/** Two quests with a scene each, the side one over a drive only that scene uses, and evidence over the main one. */
function sceneryFixture() {

	const catalogs = fixture();
	const scene = ( questId, extra = {} ) => ( {
		contractVersion: '1.0', sceneId: `scene.${questId}`, questId, seed: 7, purpose: 'crime-scene',
		place: { kind: 'room', parcelId: 'p1', floor: 0, roomKinds: [ 'living' ] },
		actors: [ { actorId: 'body', role: 'victim', identity: { kind: 'cast', roleId: 'victim' }, pose: 'death-a', placement: { zone: 'center' } } ],
		props: [ { propId: 'pool', kind: 'blood-pool', nearActorId: 'body' } ],
		activeWhen: { kind: 'stepDone', stepId: 'step' },
		...extra
	} );
	catalogs.missionAssetRequests.push( { assetId: 'drive.side' } );
	catalogs.scenery = [
		scene( 'main', { investigationSceneId: 'evidence.main' } ),
		scene( 'side', { props: [ { propId: 'drive', kind: 'mission-asset', assetId: 'drive.side' } ], retireWhen: { kind: 'flagSet', flag: 'found' } } )
	];
	catalogs.investigations = [ {
		contractVersion: '1.2', sceneId: 'evidence.main', questId: 'main', scenery: { sceneId: 'scene.main' },
		evidenceVisuals: [ { evidenceId: 'wound', entityId: 'body' } ]
	} ];
	catalogs.hostCapabilities = { transportationModes: [], scenery: structuredClone( capabilities ) };
	return catalogs;

}

describe( 'quest scenery in the bundle', () => {

	it( 'reads a 1.1 bundle as one without scenery and a 1.2 bundle with its scenery file', () => {

		const catalogs = fixture();
		const { scenery, ...older } = catalogs;
		const manifest = manifestFor( catalogs );
		const legacy = {
			contractVersion: '1.1',
			files: Object.fromEntries( Object.entries( manifest.files ).filter( ( [ name ] ) => name !== 'scenery' ) ),
			counts: Object.fromEntries( Object.entries( manifest.counts ).filter( ( [ name ] ) => name !== 'scenery' ) )
		};
		expect( questBundleFiles( legacy ) ).not.toContain( 'scenery' );
		expect( questBundle( legacy, older ).scenery ).toEqual( [] );
		expect( () => questBundle( legacy, { ...older, scenery: sceneryFixture().scenery } ) ).toThrowError( /carries no scenery/ );
		expect( () => questBundle( { ...legacy, files: manifest.files }, older ) ).toThrowError( expect.objectContaining( { code: 'E_QUEST_BUNDLE_INPUT' } ) );

		const full = sceneryFixture();
		expect( questBundleFiles( manifestFor( full ) ) ).toContain( 'scenery' );
		expect( questBundle( manifestFor( full ), full ).scenery ).toHaveLength( 2 );
		expect( () => questBundle( manifestFor( full ), { ...full, scenery: full.scenery.slice( 1 ) } ) )
			.toThrowError( expect.objectContaining( { code: 'E_QUEST_BUNDLE_COUNT' } ) );

	} );

	it( 'selects the scenes of the chosen quests with the mission assets only they use', () => {

		const full = sceneryFixture();
		const all = questBundle( manifestFor( full ), full );
		const side = selectQuestBundle( all, [ 'side' ] );
		expect( side.scenery.map( ( spec ) => spec.sceneId ) ).toEqual( [ 'scene.side' ] );
		expect( side.missionAssetRequests.map( ( request ) => request.assetId ) ).toEqual( [ 'asset.side', 'drive.side' ] );
		expect( side.manifest.counts.scenery ).toBe( 1 );
		expect( selectQuestBundle( all, [ 'main' ] ).scenery.map( ( spec ) => spec.sceneId ) ).toEqual( [ 'scene.main' ] );

	} );

	it( 'refuses scenes the host does not declare, names the questline lacks and links that disagree', () => {

		const full = sceneryFixture();
		const reject = ( change, pattern ) => {

			const catalogs = structuredClone( full );
			change( catalogs );
			expect( () => questBundle( manifestFor( catalogs ), catalogs ) ).toThrowError( pattern );

		};
		reject( ( catalogs ) => { delete catalogs.hostCapabilities.scenery; }, /needs the host scenery capability/ );
		reject( ( catalogs ) => { catalogs.hostCapabilities.scenery.poses = [ 'death-a', 'levitate' ]; }, /poses name what Engine does not stage: levitate/ );
		reject( ( catalogs ) => { catalogs.hostCapabilities.scenery.limits.props = 99; }, /props limit exceeds/ );
		reject( ( catalogs ) => { catalogs.hostCapabilities.scenery.poses = [ 'death-b' ]; }, /does not declare: pose death-a/ );
		reject( ( catalogs ) => { catalogs.scenery[ 0 ].questId = 'ghost'; }, /unknown quest ghost/ );
		reject( ( catalogs ) => { catalogs.scenery[ 1 ].activeWhen = { all: [ { kind: 'stepDone', stepId: 'nope' }, { kind: 'roleDead', roleId: 'mayor' } ] }; }, /stepId nope, roleId mayor/ );
		reject( ( catalogs ) => { catalogs.scenery[ 1 ].props[ 0 ].assetId = 'drive.gone'; }, /asset drive.gone/ );
		reject( ( catalogs ) => { catalogs.scenery[ 1 ].sceneId = 'scene.main'; }, /repeats or omits scene scene.main/ );
		reject( ( catalogs ) => { catalogs.investigations[ 0 ].evidenceVisuals[ 0 ].entityId = 'ghost'; }, /elements scene scene.main lacks: ghost/ );
		reject( ( catalogs ) => { catalogs.investigations[ 0 ].scenery.sceneId = 'scene.side'; }, /links unknown scene scene.side|which does not link it/ );
		reject( ( catalogs ) => { delete catalogs.scenery[ 0 ].investigationSceneId; }, /links scene scene.main, which names no investigation back/ );
		reject( ( catalogs ) => { catalogs.scenery[ 1 ].investigationSceneId = 'evidence.main'; }, /scene scene.side names investigation evidence.main, which does not link it/ );

	} );

} );
