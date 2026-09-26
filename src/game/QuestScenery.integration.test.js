import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { generate, expandBuilding, makePlacementFixture } from '../../../interior/src/index.ts';
import { QuestSession } from './quests/QuestSession.js';
import { npc, quest, role, simulation, step } from './quests/quest.test-fixtures.js';
import { InvestigationGameplay } from './investigation/InvestigationGameplay.js';
import interior from './investigation/fixtures/interior-incident.json';
import { SceneryDirector } from './scenery/SceneryDirector.js';
import { assets, crimeScene } from './scenery/scenery.test-fixtures.js';

/**
 * A crime scene as the game stands it: the quest session, the scenery
 * director with its own renderer and the investigation layer over it, wired
 * as GameApp wires them, in a furnished building Interior generates. Only the
 * poser, the materials and the floor stream are stand-ins.
 */

const SCENE = 'courier-found';
const EVIDENCE = [
	[ 'inspect-body-position', 'body-position', 'body-fact', 'body-found', 'courier' ],
	[ 'inspect-blood-direction', 'blood-direction', 'blood-fact', 'blood-found', 'pool' ],
	[ 'take-access-drive', 'access-card', 'drive-fact', 'drive-found', 'drive' ]
];

let buildings;

beforeAll( async () => {

	const building = await generate( makePlacementFixture( { width: 24, depth: 32, floors: 3, type: 'residential', tier: 'high_rich', seed: 11 } ) );
	buildings = new Map( [ [ 'p47', { interior: building, npc: expandBuilding( building ).npc } ] ] );

}, 30000 );

describe( 'a quest crime scene in the game', () => {

	it( 'stands the dead cast person, the blood and the evidence case in a room once its step is active, offers the evidence there, and clears it all when the quest ends', async () => {

		const game = await playing();
		const { session, director, investigations } = game;
		director.update( { timeMin: 600, feet: game.feet }, 0.5 );
		expect( director.isStaged( SCENE ) ).toBe( false );
		expect( director.group.children ).toHaveLength( 0 );
		expect( director.stagedPlaces() ).toEqual( [] );

		// Arriving kills the courier and opens the first inspection: the scene stands.
		expect( session.advanceFor( interior.questId, { kind: 'arrivedAt', parcelId: 'p47' }, 601 ) ).toHaveLength( 1 );
		director.refresh();
		director.update( { timeMin: 601, feet: game.feet } );
		expect( director.isStaged( SCENE ) ).toBe( true );
		const staged = director.sceneFor( SCENE );
		expect( staged.resolved.actors ).toEqual( [ { actorId: 'courier', npcId: 'npc-courier', gender: 'male', appearanceSeed: 4711 } ] );
		expect( staged.resolved.place ).toMatchObject( { parcelId: 'p47', floor: 1 } );
		expect( director.stagedPlaces() ).toEqual( [ { sceneId: SCENE, questId: interior.questId, purpose: 'crime-scene', place: staged.resolved.place } ] );
		await vi.waitFor( () => expect( director.renderer.isRealized( SCENE ) ).toBe( true ) );
		const drawn = director.group.children[ 0 ];
		expect( drawn.children.map( ( object ) => object.name ) ).toEqual( [ 'scenery-entity:courier', 'scenery-entity:drive', 'scenery-decal:pool' ] );
		expect( game.poser.still ).toHaveBeenCalledExactlyOnceWith( expect.objectContaining( { npcId: 'npc-courier', poseId: 'death-a' } ), 'Death01', expect.any( Number ) );
		expect( drawn.getObjectByName( 'scenery-decal:pool' ).material.name ).toBe( 'cyberpunk/incident-blood/mid' );

		// Each piece of evidence is offered on its element while its step is active, and advances the quest.
		for ( const [ stepId, , , , entityId ] of EVIDENCE ) {

			expect( session.snapshot()[ 0 ].state.activeStepIds ).toEqual( [ stepId ] );
			const frame = aimedAt( director, entityId );
			// The drive is looked at before it is taken.
			if ( entityId === 'drive' ) expect( act( investigations, frame, 'interact' ) ).toMatchObject( { ok: true, progressed: false } );
			expect( act( investigations, frame, entityId === 'drive' ? 'secondary-interact' : 'interact' ) )
				.toMatchObject( { ok: true, progressed: true, completed: [ { stepIds: [ stepId ] } ] } );

		}
		// The drive is taken out of the scene; the body and the blood stay while the quest runs.
		expect( drawn.getObjectByName( 'scenery-entity:drive' ).visible ).toBe( false );
		expect( director.isStaged( SCENE ) ).toBe( true );

		// The last evidence ended the quest: the scene retires for good, and nothing is offered there.
		expect( session.snapshot()[ 0 ].state.endingId ).toBe( 'scene-resolved' );
		director.refresh();
		director.update( { timeMin: 603, feet: game.feet } );
		expect( director.isStaged( SCENE ) ).toBe( false );
		expect( director.group.children ).toHaveLength( 0 );
		expect( game.poser.release ).toHaveBeenCalledOnce();
		expect( director.stagedPlaces() ).toEqual( [] );
		expect( investigations.candidates( aimedAt( director, 'courier', staged.assembly ) ) ).toEqual( [] );
		expect( director.serialize() ).toEqual( [ { contractVersion: '1.0', sceneId: SCENE, status: 'retired', stagedAtMin: 601, retiredAtMin: 603 } ] );

	} );

	it( 'stands a saved scene again where it stood, and goes on offering the evidence the save had not found', async () => {

		const first = await playing();
		first.session.advanceFor( interior.questId, { kind: 'arrivedAt', parcelId: 'p47' }, 601 );
		first.director.update( { timeMin: 601, feet: first.feet } );
		await vi.waitFor( () => expect( first.director.renderer.isRealized( SCENE ) ).toBe( true ) );
		expect( act( first.investigations, aimedAt( first.director, 'courier' ), 'interact' ) ).toMatchObject( { progressed: true } );
		const assembly = first.director.sceneFor( SCENE ).assembly;

		const again = await playing( {
			progress: first.session.persistenceView(), scenery: first.director.serialize(), investigations: first.investigations.serialize(), dead: true
		} );
		expect( again.director.isStaged( SCENE ) ).toBe( true );
		expect( JSON.stringify( again.director.sceneFor( SCENE ).assembly ) ).toBe( JSON.stringify( assembly ) );
		again.director.update( { timeMin: 610, feet: again.feet } );
		await vi.waitFor( () => expect( again.director.renderer.isRealized( SCENE ) ).toBe( true ) );
		const offered = again.investigations.candidates( aimedAt( again.director, 'courier' ) ).map( ( candidate ) => candidate.interaction.targetKey );
		expect( offered ).not.toContain( `investigation:${interior.sceneId}:body-position` );
		expect( act( again.investigations, aimedAt( again.director, 'pool' ), 'interact' ) )
			.toMatchObject( { ok: true, progressed: true, completed: [ { stepIds: [ 'inspect-blood-direction' ] } ] } );

	} );

} );

/** The parts GameApp wires for quest scenery, around one questline whose arrival kills the courier. */
async function playing( { progress = [], scenery = [], investigations: saved = [], dead = false } = {} ) {

	const courier = { ...npc( 'npc-courier', 'courier', 'p47' ), gender: 'male', appearanceSeed: 4711 };
	courier.flags.dead = dead;
	const sim = simulation( new Map( [ [ courier.npcId, courier ] ] ) );
	const session = QuestSession.create( [ crimeQuest() ], sim, 600, progress );
	const poser = { still: vi.fn( async () => body() ), release: vi.fn() };
	const investigations = await InvestigationGameplay.create( { requests: [ linkedInvestigation() ], session, renderer: { group: new THREE.Group() }, saved } );
	const director = SceneryDirector.create( {
		specs: [ crimeScene( {
			place: { kind: 'room', parcelId: 'p47', floor: 1, roomKinds: [ 'living', 'bedroom' ] },
			activeWhen: { kind: 'stepActive', stepId: 'inspect-body-position' },
			investigationSceneId: interior.sceneId
		} ) ],
		session, sim, world: { buildings }, missionAssets: assets, interiors: { floorShown: () => true }, overlay: investigations,
		saved: scenery, poser, materialFactory: { build: ( key ) => new THREE.MeshStandardMaterial( { name: key } ) }
	} );
	return { session, poser, investigations, director, feet: { x: 0, y: 0, z: 0 } };

}

/** E or R on the evidence the player aims at in `frame`, as the Interactor presses it. */
function act( investigations, frame, bindingAction ) {

	const [ candidate ] = investigations.candidates( frame );
	expect( candidate ).toBeDefined();
	return investigations.perform( { targetKey: candidate.interaction.targetKey, bindingAction, timeMin: frame.timeMin } );

}

/** Arriving at the flat kills the courier; the evidence steps follow in order and the last ends the quest. */
function crimeQuest() {

	const arrive = step( 'arrive', { kind: 'goto', place: { parcelId: 'p47' } }, {
		wantedByRoleId: null,
		effects: [ { kind: 'simFlag', roleId: 'courier', op: { kind: 'die' } } ],
		next: [ { toStepId: EVIDENCE[ 0 ][ 0 ], when: [] } ]
	} );
	return quest( interior.questId, {
		roles: [ role( 'courier', 'courier' ) ],
		items: EVIDENCE.map( ( [ , , itemId ] ) => ( { itemId, name: itemId, description: `${itemId} recorded.`, kind: 'information' } ) ),
		flags: EVIDENCE.map( ( [ , , , flag ] ) => flag ),
		endingId: 'scene-resolved',
		steps: [ arrive, ...EVIDENCE.map( ( [ stepId, evidenceId, itemId, flag ], index ) => step( stepId, {
			kind: 'investigation', sceneId: interior.sceneId, evidenceId, evidenceItemId: itemId,
			subjectRoleIds: [], place: { parcelId: 'p47' }, completionFlag: flag
		}, {
			wantedByRoleId: null, gives: [ itemId ], needs: index ? [ EVIDENCE[ index - 1 ][ 2 ] ] : [],
			next: index < EVIDENCE.length - 1 ? [ { toStepId: EVIDENCE[ index + 1 ][ 0 ], when: [ { kind: 'flagSet', flag } ] } ] : [],
			...( index === EVIDENCE.length - 1 ? { endingId: 'scene-resolved' } : {} )
		} ) ) ]
	} );

}

/** The 1.2 investigation that shows its evidence on the scene's body, blood and drive. */
function linkedInvestigation() {

	return {
		contractVersion: '1.2', sceneId: interior.sceneId, questId: interior.questId, incident: interior.incident,
		questBindings: interior.questBindings, scenery: { sceneId: SCENE },
		evidenceVisuals: EVIDENCE.map( ( [ , evidenceId, , , entityId ] ) => ( { evidenceId, entityId } ) ),
		evidence: interior.evidence
	};

}

/** A player a metre from one element of the scene, at the parcel, looking at it. */
function aimedAt( director, entityId, assembly = null ) {

	const placed = ( assembly ?? director.sceneFor( SCENE ).assembly );
	const element = [ ...placed.entities, ...placed.decals ].find( ( candidate ) => candidate.entityId === entityId );
	const at = element.transform.position;
	const eye = { x: at.x + 1, y: at.y + 0.6, z: at.z };
	const look = new THREE.Vector3( at.x - eye.x, at.y + 0.1 - eye.y, at.z - eye.z ).normalize();
	return {
		timeMin: 602, playerPlaces: [ { kind: 'parcel', id: 'p47' } ],
		feet: { x: eye.x, y: at.y, z: eye.z }, eye, look: { x: look.x, y: look.y, z: look.z }
	};

}

/** A still body as CharacterPoser hands it over: a lying figure with real bounds. */
function body() {

	const root = new THREE.Group();
	root.add( new THREE.Mesh( new THREE.BoxGeometry( 1.7, 0.3, 0.5 ) ) );
	return root;

}
