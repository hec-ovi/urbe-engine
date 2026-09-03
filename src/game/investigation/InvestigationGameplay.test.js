import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { QuestSession } from '../quests/QuestSession.js';
import interior from './fixtures/interior-incident.json';
import street from './fixtures/street-incident.json';
import { InvestigationError } from './InvestigationError.js';
import { InvestigationGameplay } from './InvestigationGameplay.js';
import { InvestigationSceneRenderer } from './InvestigationSceneRenderer.js';
import { SceneAssembler } from './SceneAssembler.js';

describe( 'InvestigationGameplay live integration', () => {

	it( 'requires place, reach, focus and occlusion before ordered evidence advances the exact quest', async () => {

		const session = questSession();
		const renderer = rendererStub();
		const gameplay = await InvestigationGameplay.create( { requests: [ interior ], session, renderer } );
		const frame = aimedFrame();

		expect( gameplay.candidates( { ...frame, playerPlaces: [ { kind: 'parcel', id: 'elsewhere' } ] } ) ).toEqual( [] );
		renderer.unobstructed.mockReturnValueOnce( false );
		expect( gameplay.candidates( frame ) ).toEqual( [] );

		let candidate = gameplay.candidates( frame )[ 0 ];
		expect( candidate.interaction.prompt ).toBe( "E  inspect courier's position" );
		expect( gameplay.perform( { targetKey: candidate.interaction.targetKey, bindingAction: 'interact', timeMin: 12 } ) )
			.toMatchObject( { ok: true, progressed: true, sceneId: interior.sceneId, evidenceId: 'body-position' } );

		candidate = gameplay.candidates( frame )[ 0 ];
		expect( gameplay.perform( { targetKey: candidate.interaction.targetKey, bindingAction: 'interact', timeMin: 13 } ) )
			.toMatchObject( { ok: true, progressed: true, evidenceId: 'blood-direction' } );

		candidate = gameplay.candidates( frame )[ 0 ];
		const inspected = gameplay.perform( { targetKey: candidate.interaction.targetKey, bindingAction: 'interact', timeMin: 14 } );
		expect( inspected ).toMatchObject( {
			ok: true, progressed: false, evidenceId: 'access-card',
			sceneEvents: [ { transitionId: 'record-card-owner', kind: 'quest-signal' } ]
		} );
		candidate = gameplay.candidates( frame )[ 0 ];
		const taken = gameplay.perform( { targetKey: candidate.interaction.targetKey, bindingAction: 'secondary-interact', timeMin: 15 } );
		expect( taken ).toMatchObject( {
			ok: true, progressed: true, evidenceId: 'access-card',
			completed: [ { questId: interior.questId, stepIds: [ 'take-access-drive' ], endingId: 'scene-resolved' } ],
			worldChanges: [ { entityId: 'dropped-access-card', state: 'collected' } ]
		} );
		expect( renderer.collect ).toHaveBeenCalledWith( 'dropped-access-card' );

	} );

	it( 'replays saved collection and one-shot evidence state deterministically', async () => {

		const session = questSession();
		const first = await InvestigationGameplay.create( { requests: [ interior ], session, renderer: rendererStub() } );
		completeScene( first );
		const saved = first.serialize();
		const restoredSession = QuestSession.create( [ questDefinition() ], simulation(), 0, session.persistenceView() );
		const restoredRenderer = rendererStub();
		const restored = await InvestigationGameplay.create( {
			requests: [ interior ], session: restoredSession, renderer: restoredRenderer, saved
		} );
		expect( restored.serialize() ).toEqual( saved );
		expect( restoredRenderer.collect ).toHaveBeenCalledExactlyOnceWith( 'dropped-access-card' );
		expect( restored.candidates( aimedFrame() ) ).toEqual( [] );

	} );

	it( 'rejects mismatched quest identity and malformed saved state without partial load', async () => {

		const wrong = structuredClone( interior );
		wrong.questBindings[ 0 ].evidenceId = 'blood-direction';
		await expect( InvestigationGameplay.create( { requests: [ wrong ], session: questSession(), renderer: rendererStub() } ) )
			.rejects.toBeInstanceOf( InvestigationError );
		await expect( InvestigationGameplay.create( {
			requests: [ interior ], session: questSession(), renderer: rendererStub(),
			saved: [ { contractVersion: '1.0', sceneId: interior.sceneId, revision: 0, evidence: [], emittedTransitionIds: [] } ]
		} ) ).rejects.toBeInstanceOf( InvestigationError );

	} );

} );

describe( 'InvestigationSceneRenderer production failures', () => {

	it( 'fails closed for unavailable PBR materials', async () => {

		const scene = new SceneAssembler().assemble( street );
		await expect( InvestigationSceneRenderer.create( {
			assemblies: [ scene ], materialFactory: { build: ( key ) => ( { name: 'unresolved:' + key } ) }
		} ) ).rejects.toMatchObject( { code: 'E_INVESTIGATION_MATERIAL' } );

	} );

	it( 'fails closed when the authored Source body cannot load', async () => {

		const scene = new SceneAssembler().assemble( interior );
		await expect( InvestigationSceneRenderer.create( {
			assemblies: [ scene ],
			materialFactory: { build: ( key ) => new THREE.MeshStandardMaterial( { name: key } ) },
			animation: { scene: new THREE.Group(), animations: [] },
			loadGltf: async () => { throw new Error( '404' ); }
		} ) ).rejects.toMatchObject( { code: 'E_INVESTIGATION_ASSET' } );

	} );

} );

function completeScene( gameplay ) {

	const frame = aimedFrame();
	for ( const bindingAction of [ 'interact', 'interact', 'interact', 'secondary-interact' ] ) {

		const candidate = gameplay.candidates( frame )[ 0 ];
		gameplay.perform( { targetKey: candidate.interaction.targetKey, bindingAction, timeMin: 20 } );

	}

}

function rendererStub() {

	return {
		group: new THREE.Group(),
		focus: vi.fn( () => ( { position: new THREE.Vector3( 0, 0.2, 1 ), visible: true } ) ),
		unobstructed: vi.fn( () => true ),
		collect: vi.fn()
	};

}

function aimedFrame() {

	return {
		timeMin: 10,
		playerPlaces: [ { kind: 'parcel', id: 'p47' } ],
		feet: { x: 0, y: 0, z: 0 }, eye: { x: 0, y: 0.2, z: 0 }, look: { x: 0, y: 0, z: 1 }
	};

}

function questSession() {

	return QuestSession.create( [ questDefinition() ], simulation(), 0 );

}

function questDefinition() {

	const evidence = [
		[ 'inspect-body-position', 'body-position', 'body-fact', 'body-found' ],
		[ 'inspect-blood-direction', 'blood-direction', 'blood-fact', 'blood-found' ],
		[ 'take-access-drive', 'access-card', 'drive-fact', 'drive-found' ]
	];
	return {
		id: interior.questId, title: 'Missing courier', premise: 'Read the authored incident.', roles: [],
		items: evidence.map( ( item ) => ( { itemId: item[ 2 ], name: item[ 2 ], description: item[ 2 ] + ' recorded.', kind: 'information' } ) ),
		facts: [], acts: [ { actId: 'scene', title: 'Incident', summary: 'Inspect the evidence in order.' } ],
		steps: evidence.map( ( item, index ) => ( {
			stepId: item[ 0 ], actId: 'scene',
			narrative: { description: item[ 1 ] + ' resolved.', playerHint: 'Inspect ' + item[ 1 ] + '.', stake: 'The scene remains unresolved.' },
			target: { kind: 'investigation', sceneId: interior.sceneId, evidenceId: item[ 1 ], evidenceItemId: item[ 2 ], subjectRoleIds: [], place: { parcelId: 'p47' }, completionFlag: item[ 3 ] },
			gives: [ item[ 2 ] ], needs: index ? [ evidence[ index - 1 ][ 2 ] ] : [], conditions: [],
			effects: [ { kind: 'setFlag', flag: item[ 3 ] } ],
			next: index < evidence.length - 1 ? [ { toStepId: evidence[ index + 1 ][ 0 ], when: [ { kind: 'flagSet', flag: item[ 3 ] } ] } ] : [],
			branching: 'parallel', ...( index === evidence.length - 1 ? { endingId: 'scene-resolved' } : {} )
		} ) ),
		endings: [ { endingId: 'scene-resolved', title: 'Scene resolved', epilogue: 'The evidence route is recorded.' } ],
		flags: evidence.map( ( item ) => item[ 3 ] ), entryStepIds: [ evidence[ 0 ][ 0 ] ]
	};

}

function simulation() {

	return { getNPC: () => null, findNPCs: () => [], getNPCVendor: () => null, reserveNPC: () => null, applyFlag: () => {} };

}
