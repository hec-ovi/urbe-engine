import * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';
import { QuestSession } from '../quests/QuestSession.js';
import { quest, step } from '../quests/quest.test-fixtures.js';
import interior from './fixtures/interior-incident.json';
import street from './fixtures/street-incident.json';
import { InvestigationError } from './InvestigationError.js';
import { InvestigationGameplay } from './InvestigationGameplay.js';
import { InvestigationSceneRenderer } from './InvestigationSceneRenderer.js';
import { SceneAssembler } from './SceneAssembler.js';
import { Physics } from '../physics/Physics.js';
import { SceneryCompiler } from '../scenery/SceneryCompiler.js';
import { assets, courier, crimeScene, frame } from '../scenery/scenery.test-fixtures.js';

describe( 'InvestigationGameplay live integration', () => {

	it( 'requires place, reach, focus and occlusion before ordered evidence advances the exact quest', async () => {

		const session = questSession();
		const renderer = rendererStub();
		const gameplay = await InvestigationGameplay.create( { requests: [ interior ], session, renderer } );
		const frame = aimedFrame();
		expect( gameplay.candidates( frame ) ).toEqual( [] );
		expect( await gameplay.stage( interior.sceneId, null ) ).toBe( true );
		expect( renderer.realize ).toHaveBeenCalledOnce();

		expect( gameplay.candidates( { ...frame, playerPlaces: [ { kind: 'parcel', id: 'elsewhere' } ] } ) ).toEqual( [] );
		// The player stands at transit places too, and a frame there is a frame.
		expect( gameplay.candidates( { ...frame, playerPlaces: [ { kind: 'station', id: 'st-1' }, { kind: 'stop', id: 'b-2' }, { kind: 'route', id: 'r-3' } ] } ) ).toEqual( [] );
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
		await first.stage( interior.sceneId, null );
		completeScene( first );
		const saved = first.serialize();
		const restoredSession = QuestSession.create( [ questDefinition() ], simulation(), 0, session.persistenceView() );
		const restoredRenderer = rendererStub();
		const restored = await InvestigationGameplay.create( {
			requests: [ interior ], session: restoredSession, renderer: restoredRenderer, saved
		} );
		expect( restored.serialize() ).toEqual( saved );
		expect( restoredRenderer.collect ).not.toHaveBeenCalled();
		await restored.stage( interior.sceneId, null );
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

describe( 'InvestigationGameplay over a scenery scene', () => {

	const staging = new SceneryCompiler( { missionAssets: assets } ).compile( crimeScene(), frame, courier );
	const linked = {
		contractVersion: '1.2', sceneId: interior.sceneId, questId: interior.questId, incident: interior.incident,
		questBindings: interior.questBindings, scenery: { sceneId: 'courier-found' },
		evidenceVisuals: [
			{ evidenceId: 'body-position', entityId: 'courier' },
			{ evidenceId: 'blood-direction', entityId: 'pool' },
			{ evidenceId: 'access-card', entityId: 'drive' }
		],
		evidence: interior.evidence
	};

	it( 'places its evidence exactly on the scenery scene\'s elements and acts through that scene\'s visuals', async () => {

		const renderer = rendererStub();
		const gameplay = await InvestigationGameplay.create( { requests: [ linked ], session: questSession(), renderer } );
		expect( gameplay.lifecycles() ).toEqual( [ {
			sceneId: interior.sceneId, questId: interior.questId,
			stepIds: [ 'inspect-body-position', 'inspect-blood-direction', 'take-access-drive' ], scenerySceneId: 'courier-found'
		} ] );
		await expect( gameplay.stage( interior.sceneId, null ) ).rejects.toMatchObject( { code: 'E_INVESTIGATION_BINDING' } );

		const visuals = rendererStub();
		expect( await gameplay.stage( interior.sceneId, { request: staging.request, visuals } ) ).toBe( true );
		expect( renderer.realize ).not.toHaveBeenCalled();
		const placed = gameplay.scenes.get( interior.sceneId ).assembly;
		const where = ( items ) => items.map( ( item ) => [ item.entityId, item.transform ] );
		expect( where( placed.entities ) ).toEqual( where( staging.assembly.entities ) );
		expect( where( placed.decals ) ).toEqual( where( staging.assembly.decals ) );
		expect( placed.targets.map( ( target ) => target.entityId ) ).toEqual( [ 'courier', 'pool', 'drive' ] );

		completeScene( gameplay );
		expect( visuals.collect ).toHaveBeenCalledExactlyOnceWith( 'drive' );
		gameplay.retire( interior.sceneId );
		expect( gameplay.candidates( aimedFrame() ) ).toEqual( [] );
		expect( renderer.release ).not.toHaveBeenCalled();

	} );

	it( 'takes a collected element out again when a saved scene stands, and refuses evidence without one element each', async () => {

		const first = await InvestigationGameplay.create( { requests: [ linked ], session: questSession(), renderer: rendererStub() } );
		await first.stage( interior.sceneId, { request: staging.request, visuals: rendererStub() } );
		completeScene( first );
		const saved = first.serialize();
		const restored = await InvestigationGameplay.create( { requests: [ linked ], session: questSession(), renderer: rendererStub(), saved } );
		const visuals = rendererStub();
		await restored.stage( interior.sceneId, { request: staging.request, visuals } );
		expect( visuals.collect ).toHaveBeenCalledExactlyOnceWith( 'drive' );
		expect( restored.serialize() ).toEqual( saved );

		const doubled = { ...linked, evidenceVisuals: [ ...linked.evidenceVisuals.slice( 0, 2 ), { evidenceId: 'access-card', entityId: 'pool' } ] };
		await expect( InvestigationGameplay.create( { requests: [ doubled ], session: questSession(), renderer: rendererStub() } ) )
			.rejects.toMatchObject( { code: 'E_INVESTIGATION_BINDING' } );
		const stranger = { ...linked, evidenceVisuals: [ ...linked.evidenceVisuals.slice( 0, 2 ), { evidenceId: 'access-card', entityId: 'ghost' } ] };
		const unplaced = await InvestigationGameplay.create( { requests: [ stranger ], session: questSession(), renderer: rendererStub() } );
		await expect( unplaced.stage( interior.sceneId, { request: staging.request, visuals: rendererStub() } ) )
			.rejects.toMatchObject( { code: 'E_INVESTIGATION_BINDING', message: expect.stringMatching( /ghost/ ) } );

	} );

} );

describe( 'InvestigationSceneRenderer staging', () => {

	it( 'reads each Source body once at load and warms a scene before it shows or blocks', async () => {

		const animation = { scene: rig(), animations: [ new THREE.AnimationClip( 'Death02', 1, [] ) ] };
		const loadGltf = vi.fn( async () => ( { scene: rig() } ) );
		const physics = { addTrimesh: vi.fn( () => ( {} ) ), remove: vi.fn() };
		const seen = [];
		const warmup = { warm: vi.fn( async ( group ) => {

			seen.push( { shown: gameplay.renderer.group.children.includes( group ), colliders: physics.addTrimesh.mock.calls.length, bodies: group.children.length } );

		} ) };
		const gameplay = await InvestigationGameplay.create( {
			requests: [ interior ], session: questSession(), physics, animation, loadGltf, warmup,
			materialFactory: { build: ( key ) => new THREE.MeshStandardMaterial( { name: key } ) }
		} );
		expect( loadGltf ).toHaveBeenCalledExactlyOnceWith( interior.bodies[ 0 ].asset.uri );

		expect( await gameplay.stage( interior.sceneId, null ) ).toBe( true );
		expect( loadGltf ).toHaveBeenCalledOnce();
		expect( seen ).toEqual( [ { shown: false, colliders: 0, bodies: expect.any( Number ) } ] );
		expect( seen[ 0 ].bodies ).toBeGreaterThan( 0 );
		expect( physics.addTrimesh ).toHaveBeenCalled();
		expect( gameplay.renderer.group.children ).toHaveLength( 1 );

	} );

	it( 'reads a body that failed at load again when its scene stages, and fails that scene alone', async () => {

		const animation = { scene: rig(), animations: [ new THREE.AnimationClip( 'Death02', 1, [] ) ] };
		const loadGltf = vi.fn( async () => { throw new Error( '404' ); } );
		const gameplay = await InvestigationGameplay.create( {
			requests: [ interior ], session: questSession(), animation, loadGltf,
			materialFactory: { build: ( key ) => new THREE.MeshStandardMaterial( { name: key } ) }
		} );
		expect( loadGltf ).toHaveBeenCalledOnce();
		await expect( gameplay.stage( interior.sceneId, null ) ).rejects.toMatchObject( { code: 'E_INVESTIGATION_ASSET', message: expect.stringMatching( /404/ ) } );
		expect( loadGltf ).toHaveBeenCalledTimes( 2 );
		expect( gameplay.renderer.group.children ).toHaveLength( 0 );

	} );

} );

describe( 'InvestigationSceneRenderer production failures', () => {

	it( 'ignores the selected entity collider while retaining real world occlusion', async () => {

		const scene = new SceneAssembler().assemble( street );
		const physics = await Physics.create();
		const renderer = new InvestigationSceneRenderer( {
			physics, materialFactory: { build: ( key ) => new THREE.MeshStandardMaterial( { name: key } ) }
		} );
		await renderer.realize( scene );
		physics.step( 1 / 60 );
		const entityId = 'broken-control-module';
		const focus = renderer.focus( entityId ).position;
		const eye = focus.clone().add( new THREE.Vector3( 0, 0, 2 ) );

		expect( renderer.unobstructed( eye, focus, entityId ) ).toBe( true );

		const wall = new THREE.BoxGeometry( 0.8, 0.8, 0.2 );
		wall.translate( focus.x, focus.y, focus.z + 1 );
		physics.addTrimesh( wall );
		wall.dispose();
		physics.step( 1 / 60 );
		expect( renderer.unobstructed( eye, focus, entityId ) ).toBe( false );

	} );

	it( 'renders the authored final pose and fails closed on an unavailable material or body', async () => {

		const scene = new SceneAssembler().assemble( interior );
		const materialFactory = { build: ( key ) => new THREE.MeshStandardMaterial( { name: key } ) };
		const animation = { scene: rig(), animations: [ new THREE.AnimationClip( 'Death02', 1, [] ) ] };
		const renderer = new InvestigationSceneRenderer( { materialFactory, animation, loadGltf: async () => ( { scene: rig() } ) } );
		await renderer.realize( scene );
		const body = renderer.visuals.get( 'courier-body' ).object;
		const authored = scene.entities.find( ( entity ) => entity.entityId === 'courier-body' ).transform.position;
		expect( body.position.toArray() ).toEqual( [ authored.x, authored.y, authored.z ] );
		expect( body.children[ 0 ].position.y ).toBeGreaterThan( 0 );
		expect( body.userData.finalPose ).toBe( 'Death02' );
		// The fixture's floor frame is left-handed; the stain still faces up.
		const stain = renderer.group.getObjectByName( 'investigation-decal:directional-blood-stain' );
		expect( new THREE.Vector3( 0, 0, 1 ).applyQuaternion( stain.quaternion ).y ).toBeCloseTo( 1, 6 );

		renderer.release( scene.sceneId );
		expect( renderer.group.children ).toHaveLength( 0 );
		expect( renderer.focus( 'courier-body' ) ).toBeNull();

		await expect( new InvestigationSceneRenderer( {
			materialFactory: { build: ( key ) => ( { name: 'unresolved:' + key } ) }
		} ).realize( new SceneAssembler().assemble( street ) ) ).rejects.toMatchObject( { code: 'E_INVESTIGATION_MATERIAL' } );

		await expect( new InvestigationSceneRenderer( {
			materialFactory,
			animation: { scene: new THREE.Group(), animations: [] },
			loadGltf: async () => { throw new Error( '404' ); }
		} ).realize( scene ) ).rejects.toMatchObject( { code: 'E_INVESTIGATION_ASSET' } );

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
		realize: vi.fn( async () => true ),
		release: vi.fn(),
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
	return quest( interior.questId, {
		items: evidence.map( ( item ) => ( { itemId: item[ 2 ], name: item[ 2 ], description: item[ 2 ] + ' recorded.', kind: 'information' } ) ),
		flags: evidence.map( ( item ) => item[ 3 ] ),
		endingId: 'scene-resolved',
		steps: evidence.map( ( item, index ) => step( item[ 0 ], {
			kind: 'investigation', sceneId: interior.sceneId, evidenceId: item[ 1 ], evidenceItemId: item[ 2 ],
			subjectRoleIds: [], place: { parcelId: 'p47' }, completionFlag: item[ 3 ]
		}, {
			wantedByRoleId: null, hint: 'Inspect ' + item[ 1 ], gives: [ item[ 2 ] ],
			needs: index ? [ evidence[ index - 1 ][ 2 ] ] : [],
			next: index < evidence.length - 1
				? [ { toStepId: evidence[ index + 1 ][ 0 ], when: [ { kind: 'flagSet', flag: item[ 3 ] } ] } ] : [],
			...( index === evidence.length - 1 ? { endingId: 'scene-resolved' } : {} )
		} ) )
	} );

}

function simulation() {

	return { getNPC: () => null, findNPCs: () => [], getNPCVendor: () => null, reserveNPC: () => null, applyFlag: () => {} };

}

function rig() {

	const root = new THREE.Group();
	const bone = new THREE.Bone();
	bone.name = 'Root';
	const geometry = new THREE.BoxGeometry( 0.7, 1.8, 0.4 );
	const count = geometry.getAttribute( 'position' ).count;
	geometry.setAttribute( 'skinIndex', new THREE.Uint16BufferAttribute( new Uint16Array( count * 4 ), 4 ) );
	const weights = new Float32Array( count * 4 );
	for ( let index = 0; index < count; index ++ ) weights[ index * 4 ] = 1;
	geometry.setAttribute( 'skinWeight', new THREE.Float32BufferAttribute( weights, 4 ) );
	const material = new THREE.MeshStandardMaterial();
	material.map = new THREE.Texture();
	const mesh = new THREE.SkinnedMesh( geometry, material );
	mesh.add( bone );
	mesh.bind( new THREE.Skeleton( [ bone ] ) );
	root.add( mesh );
	return root;

}
