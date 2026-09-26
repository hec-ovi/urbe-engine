import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { generate, expandBuilding, makePlacementFixture } from '../../../../interior/src/index.ts';
import { SceneryDirector } from './SceneryDirector.js';
import { assets, crimeScene, LAMP, STREET_ATLAS } from './scenery.test-fixtures.js';

let buildings;

beforeAll( async () => {

	const interior = await generate( makePlacementFixture( { width: 24, depth: 32, floors: 3, type: 'residential', tier: 'high_rich', seed: 11 } ) );
	buildings = new Map( [ [ 'p47', { interior, npc: expandBuilding( interior ).npc } ] ] );

}, 30000 );

afterEach( () => vi.restoreAllMocks() );

const NEAR = { x: 6, y: 4, z: 10 };
const FAR = { x: 400, y: 0, z: 400 };
const spec = ( extra = {} ) => crimeScene( { place: { kind: 'room', parcelId: 'p47', floor: 1, roomKinds: [ 'living', 'bedroom' ] }, ...extra } );

describe( 'scenery lifecycle', () => {

	it( 'tells walkers what stands in its street scenes, not in its rooms', () => {

		const street = crimeScene( {
			sceneId: 'hit', place: { kind: 'street', parcelId: 'p5' }, activeWhen: { kind: 'stepActive', stepId: 'arrive' },
			actors: [ { actorId: 'victim', role: 'victim', identity: { kind: 'anonymous', gender: 'male', appearanceSeed: 1 }, pose: 'death-a', placement: { zone: 'center' } } ],
			props: [ { propId: 'pool', kind: 'blood-pool', nearActorId: 'victim' } ]
		} );
		const { director, renderer, kill } = setup( [ spec( { activeWhen: { kind: 'stepActive', stepId: 'arrive' } } ), street ] );
		kill( 'npc-courier' );
		renderer.footprints.mockImplementation( ( sceneId ) => [ { sceneId } ] );
		expect( director.blockers() ).toEqual( [] );
		director.update( { timeMin: 10, feet: { x: 31, y: 0.2, z: 144 } } );
		expect( [ director.isStaged( 'courier-found' ), director.isStaged( 'hit' ) ] ).toEqual( [ true, true ] );
		expect( director.blockers() ).toEqual( [ { sceneId: 'hit' } ] );

	} );

	it( 'stays dormant until its condition holds, stages once with the dead cast person, and retires for good at the quest end', () => {

		const world = setup( [ spec() ] );
		const { director, quest, renderer } = world;
		director.update( { timeMin: 10, feet: NEAR } );
		expect( director.isStaged( 'courier-found' ) ).toBe( false );
		expect( director.serialize() ).toEqual( [ { contractVersion: '1.0', sceneId: 'courier-found', status: 'dormant' } ] );

		quest.state.completedStepIds.push( 'kill' );
		world.kill( 'npc-courier' );
		director.update( { timeMin: 11, feet: NEAR }, 0.2 );
		expect( director.isStaged( 'courier-found' ) ).toBe( false );
		director.update( { timeMin: 12, feet: NEAR }, 0.3 );
		expect( director.isStaged( 'courier-found' ) ).toBe( true );
		const staged = director.sceneFor( 'courier-found' );
		expect( staged.resolved.actors ).toEqual( [ { actorId: 'courier', npcId: 'npc-courier', gender: 'male', appearanceSeed: 314 } ] );
		expect( staged.resolved.place ).toMatchObject( { parcelId: 'p47', floor: 1 } );
		expect( staged.assembly.entities.map( ( entity ) => entity.entityId ) ).toEqual( [ 'courier', 'drive' ] );
		expect( renderer.realize ).toHaveBeenCalledExactlyOnceWith( staged.assembly );
		const notes = [ 'It looks like a crime scene.', 'A body lies on the ground.', 'There is a pool of blood on the ground.', 'A data drive lies there.' ];
		expect( director.stagedPlaces() ).toEqual( [ {
			sceneId: 'courier-found', questId: 'quest-missing-courier', purpose: 'crime-scene', place: staged.resolved.place, notes
		} ] );
		// What was taken out of the scene is gone from its notes.
		renderer.taken.mockReturnValue( new Set( [ 'drive' ] ) );
		expect( director.stagedPlaces()[ 0 ].notes ).toEqual( notes.slice( 0, 3 ) );
		expect( renderer.taken ).toHaveBeenCalledWith( 'courier-found' );

		// Flags that turn back never unstage it.
		quest.state.completedStepIds = [];
		director.refresh( 13 );
		expect( director.isStaged( 'courier-found' ) ).toBe( true );

		// A quest that moves retires it at once, at that minute.
		quest.state.endingId = 'done';
		director.refresh( 20 );
		expect( director.isStaged( 'courier-found' ) ).toBe( false );
		expect( director.stagedPlaces() ).toEqual( [] );
		expect( renderer.isRealized( 'courier-found' ) ).toBe( false );
		expect( director.serialize() ).toEqual( [ { contractVersion: '1.0', sceneId: 'courier-found', status: 'retired', stagedAtMin: 12, retiredAtMin: 20 } ] );

		delete quest.state.endingId;
		quest.state.completedStepIds = [ 'kill' ];
		director.refresh( 21 );
		expect( director.sceneFor( 'courier-found' ).status ).toBe( 'retired' );

	} );

	it( 'keeps a scene that never retires as lasting world state', () => {

		const { director, quest, kill } = setup( [ spec( { retireWhen: { kind: 'never' } } ) ] );
		quest.state.completedStepIds.push( 'kill' );
		kill( 'npc-courier' );
		quest.state.endingId = 'done';
		director.update( { timeMin: 5, feet: NEAR } );
		// Already ended before it ever stood: a scene that never retires still stages.
		expect( director.isStaged( 'courier-found' ) ).toBe( true );
		director.refresh( 900 );
		expect( director.isStaged( 'courier-found' ) ).toBe( true );

	} );

	it( 'draws a staged scene only near its frame and while its floor is shown', () => {

		const world = setup( [ spec( { activeWhen: { kind: 'questStarted' } } ) ] );
		const { director, quest, renderer } = world;
		quest.state.completedStepIds.push( 'arrive' );
		world.kill( 'npc-courier' );
		world.shown = false;
		director.update( { timeMin: 1, feet: NEAR } );
		expect( director.isStaged( 'courier-found' ) ).toBe( true );
		expect( renderer.realize ).not.toHaveBeenCalled();
		expect( world.interiors.floorShown ).toHaveBeenCalledWith( 'p47', 1 );

		world.shown = true;
		director.update( { timeMin: 1, feet: FAR } );
		expect( renderer.realize ).not.toHaveBeenCalled();
		director.update( { timeMin: 1, feet: NEAR } );
		expect( renderer.isRealized( 'courier-found' ) ).toBe( true );

		world.shown = false;
		director.update( { timeMin: 1, feet: NEAR } );
		expect( renderer.isRealized( 'courier-found' ) ).toBe( false );

	} );

	it( 'fails a scene whose cast person is alive for the session, and the other scenes play on', () => {

		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		const mourner = spec( {
			sceneId: 'wake', activeWhen: { kind: 'stepDone', stepId: 'kill' }, props: [],
			actors: [ { actorId: 'mourner', role: 'bystander', identity: { kind: 'anonymous', gender: 'female', appearanceSeed: 9 }, pose: 'grieving', placement: { zone: 'center' } } ]
		} );
		const { director, quest } = setup( [ spec(), mourner ] );
		quest.state.completedStepIds.push( 'kill' );
		director.update( { timeMin: 3, feet: FAR } );
		expect( director.sceneFor( 'courier-found' ).failed ).toBe( 'E_SCENERY_IDENTITY' );
		expect( warn ).toHaveBeenCalledWith( expect.stringMatching( /courier-found: E_SCENERY_IDENTITY .*npc-courier, who is alive/ ) );
		expect( director.isStaged( 'wake' ) ).toBe( true );
		expect( director.serialize().map( ( state ) => state.status ) ).toEqual( [ 'dormant', 'staged' ] );

	} );

	it( 'stands a saved scene again from its resolution, and keeps what it cannot stand unchanged', () => {

		const first = setup( [ spec() ] );
		first.quest.state.completedStepIds.push( 'kill' );
		first.kill( 'npc-courier' );
		first.director.update( { timeMin: 12, feet: NEAR } );
		const saved = first.director.serialize();
		const assembly = first.director.sceneFor( 'courier-found' ).assembly;

		// The person the cast names now is somebody else, alive: the saved resolution stands.
		const again = setup( [ spec() ], { saved } );
		expect( again.director.isStaged( 'courier-found' ) ).toBe( true );
		expect( JSON.stringify( again.director.sceneFor( 'courier-found' ).assembly ) ).toBe( JSON.stringify( assembly ) );
		expect( again.director.serialize() ).toEqual( saved );

		const ended = setup( [ spec() ], { saved: [ { contractVersion: '1.0', sceneId: 'courier-found', status: 'retired', retiredAtMin: 3 } ] } );
		ended.quest.state.completedStepIds.push( 'kill' );
		ended.kill( 'npc-courier' );
		ended.director.update( { timeMin: 30, feet: NEAR } );
		expect( ended.director.isStaged( 'courier-found' ) ).toBe( false );
		expect( ended.renderer.realize ).not.toHaveBeenCalled();

		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		const lost = structuredClone( saved[ 0 ] );
		lost.resolved.place.roomId = 'f1-gone';
		const foreign = { contractVersion: '1.0', sceneId: 'old-scene', status: 'retired', retiredAtMin: 3 };
		const broken = setup( [ spec() ], { saved: [ lost, foreign ] } );
		expect( broken.director.isStaged( 'courier-found' ) ).toBe( false );
		expect( broken.director.serialize() ).toEqual( [ lost, foreign ] );
		expect( warn.mock.calls.map( ( [ line ] ) => line ) ).toEqual( [
			expect.stringMatching( /courier-found: E_SCENERY_STATE .*f1-gone/ ), expect.stringMatching( /old-scene: E_SCENERY_STATE/ )
		] );

	} );

	it( 'stages investigation scenes: a linked one with its scenery scene, the rest while a bound step is open', async () => {

		const overlay = {
			lifecycles: () => [
				{ sceneId: 'evidence', questId: 'quest-missing-courier', stepIds: [ 'inspect' ], scenerySceneId: 'courier-found' },
				{ sceneId: 'ledger', questId: 'quest-missing-courier', stepIds: [ 'read' ], scenerySceneId: null }
			],
			stage: vi.fn( async () => true ),
			retire: vi.fn()
		};
		const { director, quest, kill, renderer } = setup( [ spec( { investigationSceneId: 'evidence' } ) ], { overlay } );
		director.update( { timeMin: 1, feet: FAR } );
		expect( overlay.stage ).not.toHaveBeenCalled();

		quest.state.activeStepIds.push( 'read' );
		director.refresh( 2 );
		await Promise.resolve();
		expect( overlay.stage ).toHaveBeenCalledExactlyOnceWith( 'ledger', null );

		quest.state.completedStepIds.push( 'kill' );
		kill( 'npc-courier' );
		director.refresh( 3 );
		expect( overlay.stage ).toHaveBeenCalledWith( 'evidence', {
			request: director.sceneFor( 'courier-found' ).request,
			visuals: renderer.visuals.mock.results[ 0 ].value
		} );
		expect( renderer.visuals ).toHaveBeenCalledWith( 'courier-found' );

		quest.state.endingId = 'done';
		director.refresh( 4 );
		expect( overlay.retire.mock.calls.map( ( [ sceneId ] ) => sceneId ).sort() ).toEqual( [ 'evidence', 'ledger' ] );

	} );

	it( 'warns of an investigation scene that cannot stand and plays on', async () => {

		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		const overlay = {
			lifecycles: () => [ { sceneId: 'evidence', questId: 'quest-missing-courier', stepIds: [ 'inspect' ], scenerySceneId: 'courier-found' } ],
			stage: vi.fn( async () => { throw Object.assign( new Error( 'evidence ghost has no element' ), { code: 'E_INVESTIGATION_BINDING' } ); } ),
			retire: vi.fn()
		};
		const { director, quest, kill } = setup( [ spec( { investigationSceneId: 'evidence' } ) ], { overlay } );
		quest.state.completedStepIds.push( 'kill' );
		kill( 'npc-courier' );
		director.update( { timeMin: 3, feet: FAR } );
		await vi.waitFor( () => expect( warn ).toHaveBeenCalledWith( 'scenery evidence: E_INVESTIGATION_BINDING evidence ghost has no element' ) );
		expect( director.isStaged( 'courier-found' ) ).toBe( true );

	} );

	it( 'refuses specs that name what their quest lacks, and waits on a quest the cast could not fill', () => {

		expect( () => setup( [ spec( { activeWhen: { kind: 'stepDone', stepId: 'flee' } } ) ] ) )
			.toThrowError( expect.objectContaining( { code: 'E_SCENERY_BINDING', message: expect.stringMatching( /stepId flee/ ) } ) );
		expect( () => setup( [ spec( { questId: 'ghost' } ) ] ) ).toThrowError( expect.objectContaining( { code: 'E_SCENERY_BINDING' } ) );
		expect( () => setup( [ spec( { props: [ { propId: 'courier', kind: 'blood-pool' } ] } ) ] ) )
			.toThrowError( expect.objectContaining( { code: 'E_SCENERY_INPUT', message: expect.stringMatching( /repeats element courier/ ) } ) );
		expect( () => setup( [ spec( { purpose: 'party' } ) ] ) ).toThrowError( expect.objectContaining( { code: 'E_SCENERY_INPUT' } ) );
		expect( () => setup( [ spec( { actors: [ { ...spec().actors[ 0 ], pose: 'grieving' } ] } ) ] ) ).toThrowError( expect.objectContaining( { code: 'E_SCENERY_INPUT' } ) );
		expect( () => setup( [ spec() ], { animation: { animations: [ new THREE.AnimationClip( 'Death01', 1, [] ) ] } } ) )
			.toThrowError( expect.objectContaining( { code: 'E_SCENERY_ASSET', message: expect.stringMatching( /Death02/ ) } ) );

		// A linked investigation and its scene name each other.
		const linking = ( scenerySceneId ) => ( {
			lifecycles: () => [ { sceneId: 'evidence', questId: 'quest-missing-courier', stepIds: [ 'inspect' ], scenerySceneId } ],
			stage: vi.fn(), retire: vi.fn()
		} );
		expect( () => setup( [ spec() ], { overlay: linking( 'courier-found' ) } ) )
			.toThrowError( expect.objectContaining( { code: 'E_SCENERY_BINDING', message: expect.stringMatching( /names no investigation back/ ) } ) );
		expect( () => setup( [ spec( { investigationSceneId: 'evidence' } ) ], { overlay: linking( null ) } ) )
			.toThrowError( expect.objectContaining( { code: 'E_SCENERY_BINDING', message: expect.stringMatching( /names investigation evidence, which does not link it/ ) } ) );

		const blocked = setup( [ spec() ], { blocked: true } );
		blocked.director.update( { timeMin: 1, feet: NEAR } );
		expect( blocked.director.serialize() ).toEqual( [ { contractVersion: '1.0', sceneId: 'courier-found', status: 'dormant' } ] );

	} );

} );

function setup( specs, { saved = [], overlay = null, animation = null, blocked = false } = {} ) {

	const quest = { cast: { courier: 'npc-courier' }, state: { activeStepIds: [ 'arrive' ], completedStepIds: [], flags: [] } };
	const definition = {
		id: 'quest-missing-courier',
		steps: [ 'arrive', 'kill', 'inspect', 'read' ].map( ( stepId ) => ( { stepId } ) ),
		flags: [], roles: [ { roleId: 'courier' } ]
	};
	const runtime = { cast: quest.cast, serialize: () => structuredClone( quest.state ) };
	const session = blocked
		? { entries: [], blocked: [ { id: definition.id } ] }
		: { entries: [ { definition, side: false, runtime } ], blocked: [] };
	const dead = new Set();
	const sim = { getNPC: ( npcId ) => ( { npcId, gender: 'male', appearanceSeed: 314, flags: { dead: dead.has( npcId ) } } ) };
	const world = { quest, kill: ( npcId ) => dead.add( npcId ), shown: true, renderer: fakeRenderer() };
	world.interiors = { floorShown: vi.fn( () => world.shown ) };
	world.director = SceneryDirector.create( {
		specs, session, sim, world: { buildings, atlas: STREET_ATLAS, obstacles: LAMP }, missionAssets: assets, interiors: world.interiors,
		overlay, renderer: world.renderer, animation, saved
	} );
	return world;

}

function fakeRenderer() {

	const realized = new Set();
	return {
		group: new THREE.Group(),
		realize: vi.fn( async ( assembly ) => { realized.add( assembly.sceneId ); return true; } ),
		unrealize: vi.fn( ( sceneId ) => realized.delete( sceneId ) ),
		isRealized: ( sceneId ) => realized.has( sceneId ),
		isPending: () => false,
		visuals: vi.fn( ( sceneId ) => ( { sceneId } ) ),
		taken: vi.fn( () => new Set() ),
		footprints: vi.fn( () => [] )
	};

}
