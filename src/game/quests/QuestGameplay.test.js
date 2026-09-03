import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { QuestGameplay, questGameplayWorld } from './QuestGameplay.js';
import { QuestActionError } from './QuestActionError.js';
import { MissionItemAssets } from './MissionItemAssets.js';
import { Physics } from '../physics/Physics.js';

const FEET = new THREE.Vector3( 0, 0, 0 );
const EYE = new THREE.Vector3( 0, 1.7, 0 );
const PARCEL = { kind: 'parcel', id: 'p9' };

describe( 'live quest target projection', () => {

	it( 'puts a stable pickup prop at the parcel anchor, reads it in place, and removes it only from the accepted world change', () => {

		const target = questTarget( 'pickup', [ action( 'take', 'Take' ), action( 'read', 'Read', 'secondary-interact' ) ] );
		const actions = fakeActions( target );
		const gameplay = setup( actions );
		const candidate = gameplay.candidates( frame( pointLook( 0, 0.2, - 2 ) ) )[ 0 ];

		expect( gameplay.staticMarks.get( target.targetKey ).name ).toBe( `quest-target:${target.targetKey}` );
		expect( gameplay.group.children ).toHaveLength( 1 );
		expect( candidate.interaction.prompt ).toBe( 'E  take target pickup   R  read target pickup' );

		actions.perform.mockReturnValueOnce( result( 'read' ) );
		gameplay.perform( perform( candidate, 'secondary-interact' ) );
		expect( actions.perform ).toHaveBeenLastCalledWith( expect.objectContaining( {
			targetKey: target.targetKey, action: 'read', playerPlaces: [ PARCEL ],
			focus: expect.objectContaining( { visible: true, unobstructed: true } )
		} ) );
		expect( gameplay.group.children ).toHaveLength( 1 );

		actions.perform.mockReturnValueOnce( result( 'take', [ { targetKey: target.targetKey, state: 'collected' } ] ) );
		gameplay.perform( perform( candidate ) );
		expect( gameplay.group.children ).toHaveLength( 0 );

	} );

	it( 'renders and collides the exact bound assembly without letting it occlude its own interaction', async () => {

		const physics = await Physics.create();
		const factory = { build: vi.fn( ( key, variantId ) => new THREE.MeshStandardMaterial( { name: `${key}#${variantId}` } ) ) };
		const target = questTarget( 'pickup', [ action( 'take', 'Take' ) ] );
		const actions = fakeActions( target );
		const missionItems = missionItemAssets();
		const assembly = missionItems.get( 'q', 'item.case' );
		const gameplay = setup( actions, { physics, playerCollider: null, materialFactory: factory, missionItems } );
		const candidate = gameplay.candidates( frame( pointLook( 0, MISSION_REQUEST.dimensions.height * 0.65, - 2 ) ) )[ 0 ];
		const mark = gameplay.staticMarks.get( target.targetKey );
		const shell = mark.getObjectByName( `${MISSION_REQUEST.assetId}:lower-cover` );

		expect( mark.userData.assetId ).toBe( MISSION_REQUEST.assetId );
		expect( shell.geometry.parameters ).toMatchObject( {
			width: assembly.geometry.primitives[ 0 ].size.width,
			height: assembly.geometry.primitives[ 0 ].size.height,
			depth: assembly.geometry.primitives[ 0 ].size.depth
		} );
		expect( factory.build ).toHaveBeenCalledWith( 'cyberpunk/fabric/mid', 'flat' );
		expect( candidate.interaction.targetKey ).toBe( target.targetKey );

		physics.world.step();
		const ray = new physics.rapier.Ray( { x: 0, y: 0.001, z: 0 }, { x: 0, y: 0, z: -1 } );
		expect( physics.world.castRay( ray, 3, true ) ).not.toBe( null );

		actions.perform.mockReturnValueOnce( result( 'take', [ { targetKey: target.targetKey, state: 'collected' } ] ) );
		gameplay.perform( perform( candidate ) );
		expect( physics.world.castRay( ray, 3, true ) ).toBe( null );

	} );

	it( 'does not advertise a pickup that has no exact mission item binding', () => {

		const target = questTarget( 'pickup', [ action( 'take', 'Take' ) ] );
		const gameplay = setup( fakeActions( target ), { missionItems: { get: () => null } } );

		expect( gameplay.candidates( frame( pointLook( 0, 0.2, - 2 ) ) ) ).toEqual( [] );
		expect( gameplay.staticMarks.has( target.targetKey ) ).toBe( false );

	} );

	it.each( [
		[ 'observe', 'inspect', { kind: 'district', id: 'd0' } ],
		[ 'work', 'work', PARCEL ],
		[ 'deliver', 'deliver', PARCEL ]
	] )( 'routes the %s area prompt through QuestActions as %s', ( kind, actionId, place ) => {

		const target = questTarget( kind, [ action( actionId, actionId ) ], place );
		const actions = fakeActions( target );
		const gameplay = setup( actions );
		const state = frame( new THREE.Vector3( 0, 0, - 1 ), [ place ] );
		const candidate = gameplay.candidates( state )[ 0 ];

		expect( candidate.kind ).toBe( 'quest' );
		gameplay.perform( perform( candidate ) );
		expect( actions.perform ).toHaveBeenCalledWith( expect.objectContaining( { action: actionId, playerPlaces: [ place ] } ) );

	} );

	it( 'animates only an accepted action and retains exact listen participants', () => {

		const members = [
			{ npcId: 'cast-a', position: new THREE.Vector3( - 0.3, 0, - 2 ) },
			{ npcId: 'cast-b', position: new THREE.Vector3( 0.3, 0, - 2 ) }
		];
		const target = { ...questTarget( 'listen', [ action( 'listen', 'Listen' ) ] ), actorIds: members.map( ( member ) => member.npcId ) };
		const actions = fakeActions( target );
		const animations = { questInteraction: vi.fn() };
		const gameplay = setup( actions, {
			animations,
			crowd: { questMember: vi.fn( ( npcId ) => members.find( ( member ) => member.npcId === npcId ) ) }
		} );
		const candidate = gameplay.candidates( frame( pointLook( 0, 1.3, - 2 ) ) )[ 0 ];

		gameplay.perform( perform( candidate ) );
		expect( animations.questInteraction ).toHaveBeenCalledWith( {
			targetKey: target.targetKey, action: 'listen', members
		} );

		actions.perform.mockReturnValueOnce( { ...result( 'listen' ), ok: false } );
		gameplay.perform( perform( candidate ) );
		expect( animations.questInteraction ).toHaveBeenCalledOnce();

	} );

	it.each( [
		[ 'steal', [ 'cast-guard' ], [ new THREE.Vector3( 0, 0, - 1 ) ] ],
		[ 'listen', [ 'cast-a', 'cast-b' ], [ new THREE.Vector3( - 0.3, 0, - 2 ), new THREE.Vector3( 0.3, 0, - 2 ) ] ]
	] )( 'requires the exact cast actors and an unobstructed focus for %s', ( kind, actorIds, positions ) => {

		const target = { ...questTarget( kind, [ action( kind, kind ) ] ), actorIds };
		const actions = fakeActions( target );
		const crowd = {
			questMember: vi.fn( ( npcId ) => ( { npcId, position: positions[ actorIds.indexOf( npcId ) ] } ) )
		};
		const gameplay = setup( actions, { crowd } );
		const look = pointLook( 0, 1.3, kind === 'steal' ? - 1 : - 2 );
		const candidate = gameplay.candidates( frame( look ) )[ 0 ];

		expect( crowd.questMember.mock.calls.map( ( call ) => call[ 0 ] ) ).toEqual( actorIds );
		gameplay.perform( perform( candidate ) );
		expect( actions.perform ).toHaveBeenCalledWith( expect.objectContaining( { action: kind, focus: expect.any( Object ) } ) );

		const blocked = setup( fakeActions( target ), { crowd, blocked: true } );
		expect( blocked.candidates( frame( look ) ) ).toEqual( [] );

	} );

	it( 'validates the city projection, frame and selected binding at the live boundary', () => {

		const world = questGameplayWorld(
			{ parcels: [ { id: 'p9', access: { point: [ 4, 5 ] } } ] },
			[ { parcelId: 'p9', inside: new THREE.Vector3( 1, 2, 3 ) } ]
		);
		expect( world ).toEqual( { parcels: [ { id: 'p9', anchor: [ 1, 2, 3 ] } ] } );

		const gameplay = setup( fakeActions( questTarget( 'pickup', [ action( 'take', 'Take' ) ] ) ) );
		expect( () => gameplay.candidates( { ...frame( pointLook( 0, 0.2, - 2 ) ), playerPlaces: [ { kind: 'parcel' } ] } ) )
			.toThrowError( QuestActionError );
		expect( () => gameplay.perform( { targetKey: 'quest:q:pickup', bindingAction: 'key-e', timeMin: 600 } ) )
			.toThrowError( QuestActionError );

	} );

} );

describe( 'explicit quest NPC control', () => {

	it( 'starts and releases only the selected actual cast npcId', () => {

		const actor = ( mode ) => ( {
			npcId: 'cast-a', name: { given: 'Ana', family: 'Silva' }, type: 'courier', gender: 'female', appearanceSeed: 8,
			place: { kind: 'edge', id: 'e1' }, position: [ 1, 0, 2 ], heading: 0, animation: 'walk', mode,
			schedule: { activity: 'commuting', progress: 0.2, nextDestination: { kind: 'parcel', id: 'p9' } }, visible: true
		} );
		const continuity = {
			startFollow: vi.fn( () => actor( 'following' ) ),
			stopFollow: vi.fn( () => actor( 'resuming' ) ),
			serialize: vi.fn( () => ( { follow: { npcId: 'cast-a', mode: 'following' } } ) )
		};
		const crowd = { questMember: () => null, syncActor: vi.fn() };
		const session = { hasCastNpc: ( npcId ) => npcId === 'cast-a' };
		const gameplay = setup( fakeActions( questTarget( 'observe', [ action( 'inspect', 'Inspect' ) ] ) ), {
			crowd, session, continuity
		} );
		const request = { kind: 'start-follow', npcId: 'cast-a', timeMin: 600, playerPosition: { x: 3, y: 0, z: 4 } };

		expect( gameplay.control( request ) ).toEqual( { ok: true, kind: 'start-follow', npcId: 'cast-a', mode: 'following' } );
		expect( continuity.startFollow ).toHaveBeenCalledWith( { npcId: 'cast-a', timeMin: 600, playerPosition: [ 3, 0, 4 ] } );
		expect( crowd.syncActor ).toHaveBeenCalledWith( expect.objectContaining( { npcId: 'cast-a' } ), expect.any( THREE.Vector3 ) );

		expect( gameplay.control( { ...request, kind: 'release-follow' } ) )
			.toEqual( { ok: true, kind: 'release-follow', npcId: 'cast-a', mode: 'resuming' } );
		expect( continuity.stopFollow ).toHaveBeenCalledWith( { timeMin: 600 } );

	} );

	it( 'starts and releases crouch only for the selected cast NPC', () => {

		const state = { pose: null };
		const actor = ( mode, animation ) => ( {
			npcId: 'cast-a', name: { given: 'Ana', family: 'Silva' }, type: 'courier', gender: 'female', appearanceSeed: 8,
			place: { kind: 'edge', id: 'e1' }, position: [ 1, 0, 2 ], heading: 0, animation, mode,
			schedule: { activity: 'commuting', progress: 0.2, nextDestination: { kind: 'parcel', id: 'p9' } }, visible: true
		} );
		const continuity = {
			startCrouch: vi.fn( ( request ) => {

				state.pose = { npcId: request.npcId, kind: 'crouch' };
				return actor( 'posing', 'crouch' );

			} ),
			releaseCrouch: vi.fn( () => {

				state.pose = null;
				return actor( 'resuming', 'walk' );

			} ),
			serialize: vi.fn( () => state )
		};
		const crowd = { questMember: () => null, syncActor: vi.fn() };
		const animations = { npcControl: vi.fn() };
		const gameplay = setup( fakeActions( questTarget( 'observe', [ action( 'inspect', 'Inspect' ) ] ) ), {
			crowd, animations, continuity, session: { hasCastNpc: ( npcId ) => npcId === 'cast-a' }
		} );
		const request = { kind: 'start-crouch', npcId: 'cast-a', timeMin: 600, playerPosition: { x: 3, y: 0, z: 4 } };

		expect( gameplay.control( request ) ).toEqual( {
			ok: true, kind: 'start-crouch', npcId: 'cast-a', mode: 'posing'
		} );
		expect( continuity.startCrouch ).toHaveBeenCalledWith( { npcId: 'cast-a', timeMin: 600 } );
		expect( animations.npcControl ).toHaveBeenLastCalledWith( request, expect.objectContaining( { animation: 'crouch' } ) );

		const release = { ...request, kind: 'release-crouch' };
		expect( gameplay.control( release ) ).toEqual( {
			ok: true, kind: 'release-crouch', npcId: 'cast-a', mode: 'resuming'
		} );
		expect( continuity.releaseCrouch ).toHaveBeenCalledWith( { npcId: 'cast-a', timeMin: 600 } );
		expect( animations.npcControl ).toHaveBeenLastCalledWith( release, expect.objectContaining( { animation: 'walk' } ) );

		expect( gameplay.control( { ...request, npcId: 'stranger' } ) ).toMatchObject( {
			ok: false, error: 'not_cast'
		} );

	} );

	it( 'fails closed for a non-cast identity, unavailable actor, or mismatched release', () => {

		const continuity = {
			startFollow: vi.fn( () => { throw Object.assign( new Error( 'no authored route' ), { code: 'E_NPC_PATH' } ); } ),
			serialize: vi.fn( () => ( { follow: { npcId: 'cast-b', mode: 'following' } } ) )
		};
		const gameplay = setup( fakeActions( questTarget( 'observe', [ action( 'inspect', 'Inspect' ) ] ) ), {
			session: { hasCastNpc: ( npcId ) => npcId === 'cast-a' },
			continuity,
			crowd: { questMember: () => null, syncActor: vi.fn() }
		} );
		const request = { kind: 'start-follow', npcId: 'stranger', timeMin: 600, playerPosition: { x: 0, y: 0, z: 0 } };

		expect( gameplay.control( request ) ).toMatchObject( { ok: false, error: 'not_cast', npcId: 'stranger' } );
		expect( continuity.startFollow ).not.toHaveBeenCalled();
		expect( gameplay.control( { ...request, npcId: 'cast-a' } ) ).toMatchObject( { ok: false, error: 'unreachable' } );
		expect( gameplay.control( { ...request, npcId: 'cast-a', kind: 'release-follow' } ) )
			.toMatchObject( { ok: false, error: 'conflict' } );
		expect( () => gameplay.control( { ...request, npcId: 'cast-a', kind: 'escort' } ) ).toThrowError( QuestActionError );

	} );

} );

function setup( actions, {
	crowd = { questMember: () => null }, blocked = false, session = null, continuity = null, animations = null,
	physics = null, playerCollider = {}, materialFactory = null, missionItems = missionItemAssets()
} = {} ) {

	class Ray {

		constructor( origin, dir ) { this.origin = origin; this.dir = dir; }

	}

	return new QuestGameplay( {
		actions, session, continuity, animations,
		world: { parcels: [ { id: 'p9', anchor: [ 0, 0, - 2 ] } ] },
		crowd,
		physics: physics ?? { rapier: { Ray }, world: { castRay: () => blocked ? { toi: 0.5 } : null } },
		playerCollider,
		materialFactory: materialFactory ?? { build: () => new THREE.MeshStandardMaterial( { color: 0x223344 } ) },
		missionItems
	} );

}

function perform( candidate, bindingAction = 'interact' ) {

	return { targetKey: candidate.interaction.targetKey, bindingAction, timeMin: 600 };

}

function fakeActions( target ) {

	return {
		targets: vi.fn( () => [ target ] ),
		objective: vi.fn( () => null ),
		perform: vi.fn( ( request ) => result( request.action ) )
	};

}

function questTarget( kind, actions, place = PARCEL ) {

	return {
		targetKey: `quest:q:${kind}`, questId: 'q', stepId: kind, kind, place, actorIds: [],
		...( kind === 'pickup' ? { item: { id: 'item.case', name: 'Case file', description: 'Evidence', kind: 'document', quantity: 1 } } : {} ),
		presentation: { name: `target ${kind}`, description: `${kind} target`, icon: kind, highlight: 'area-marker', actions },
		availability: { available: true }
	};

}

const MISSION_CATALOG = {
	contractVersion: '1.0', entries: [ { key: 'cyberpunk/fabric/mid', variants: [ 'flat' ] } ]
};
const MISSION_REQUEST = {
	contractVersion: '1.0', assetId: 'asset.case-file', purpose: 'Case file', family: 'document',
	dimensions: { width: 0.24, height: 0.018, depth: 0.32 },
	materials: [ { slot: 'surface', key: 'cyberpunk/fabric/mid', variantId: 'flat' } ],
	requiredInteractions: [ 'inspect', 'read', 'take' ],
	clearance: { approachDepth: 1, sideMargin: 0.3, overhead: 0.2 }, seed: 8
};

function missionItemAssets() {

	return new MissionItemAssets( {
		requests: [ MISSION_REQUEST ],
		bindings: [ { questId: 'q', itemId: 'item.case', assetId: MISSION_REQUEST.assetId } ],
		materialCatalog: MISSION_CATALOG
	} );

}

function action( actionId, label, bindingAction = 'interact' ) {

	return { action: actionId, label, bindingAction, progressesQuest: actionId !== 'read' };

}

function frame( look, playerPlaces = [ PARCEL ] ) {

	return { timeMin: 600, playerPlaces, feet: jsonVector( FEET ), eye: jsonVector( EYE ), look: jsonVector( look ) };

}

function jsonVector( vector ) {

	return { x: vector.x, y: vector.y, z: vector.z };

}

function pointLook( x, y, z ) {

	return new THREE.Vector3( x, y, z ).sub( EYE ).normalize();

}

function result( actionId, worldChanges = [] ) {

	return {
		ok: true, targetKey: `quest:q:${actionId}`, action: actionId, progressed: actionId !== 'read',
		message: `${actionId} result`, completed: [], inventory: [], worldChanges
	};

}
