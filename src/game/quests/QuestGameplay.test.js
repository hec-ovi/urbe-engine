import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { QuestGameplay, questGameplayWorld } from './QuestGameplay.js';
import { QuestActionError } from './QuestActionError.js';
import { MissionItemAssets } from './MissionItemAssets.js';
import { Physics } from '../physics/Physics.js';
import { ImpactWorld } from '../physics/ImpactWorld.js';

const FEET = new THREE.Vector3( 0, 0, 0 );
const EYE = new THREE.Vector3( 0, 1.7, 0 );
const PARCEL = { kind: 'parcel', id: 'p9' };
const CHEST = 1.3;

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

		// No exact mission item binding, no advertised pickup.
		const unbound = setup( fakeActions( target ), { missionItems: { get: () => null } } );
		expect( unbound.candidates( frame( pointLook( 0, 0.2, - 2 ) ) ) ).toEqual( [] );
		expect( unbound.staticMarks.has( target.targetKey ) ).toBe( false );

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

	it( 'rings every questline\'s open place, stands an open talk cast there and marks their heads', () => {

		const place = ( questId, kind, actorIds = [], availability = { available: true } ) => ( {
			targetKey: `quest:${questId}:${kind}`, questId, stepId: kind, kind, title: questId, text: 'Go there',
			place: PARCEL, actorIds, venue: null, window: null, availability
		} );
		const member = { position: new THREE.Vector3( 1, 0, - 2 ) };
		const actions = { targets: () => [], objective: vi.fn( () => null ), places: vi.fn( () => [] ), perform: vi.fn() };
		const crowd = { questMember: () => null, castMember: vi.fn( () => member ) };
		const gameplay = setup( actions, { crowd } );

		// A side job's goto is marked even though the main quest is the objective.
		actions.places.mockReturnValue( [ place( 'q_main', 'goto' ), place( 'q_side', 'goto' ) ] );
		gameplay.candidates( frame( pointLook( 0, 0.2, - 2 ) ) );
		expect( gameplay.staticMarks.get( 'quest:q_main:goto' ).position.toArray() ).toEqual( [ 0, 0.03, - 2 ] );
		expect( gameplay.staticMarks.get( 'quest:q_side:goto' ).position.toArray() ).toEqual( [ 0, 0.03, - 2 ] );
		expect( crowd.castMember ).not.toHaveBeenCalled();

		// A step the runtime has closed keeps its mark and stands nobody there.
		actions.places.mockReturnValue( [ place( 'q_side', 'talk', [ 'npc-denna' ], { available: false, reason: 'outside_window' } ) ] );
		gameplay.candidates( frame( pointLook( 0, 0.2, - 2 ) ) );
		expect( gameplay.staticMarks.has( 'quest:q_main:goto' ) ).toBe( false );
		expect( gameplay.staticMarks.get( 'quest:q_side:talk' ).userData ).toEqual( { targetKey: 'quest:q_side:talk', kind: 'talk' } );
		expect( crowd.castMember ).not.toHaveBeenCalled();
		expect( gameplay.actorMarks.has( 'quest:q_side:talk' ) ).toBe( false );

		// Open, so the person stands there and wears a mark over their head.
		actions.places.mockReturnValue( [ place( 'q_side', 'talk', [ 'npc-denna' ] ) ] );
		gameplay.candidates( frame( pointLook( 0, 0.2, - 2 ) ) );
		expect( crowd.castMember ).toHaveBeenCalledWith( 'npc-denna', 600, expect.objectContaining( { x: 0, z: 0 } ), 'p9' );
		const [ mark ] = gameplay.actorMarks.get( 'quest:q_side:talk' );
		expect( mark.position.toArray() ).toEqual( [ 1, 2.15, - 2 ] );
		expect( mark.material.depthTest ).toBe( false );
		expect( mark.renderOrder ).toBeGreaterThan( 1 );

		actions.places.mockReturnValue( [ place( 'q_side', 'talk', [ 'npc-denna' ], { available: false, reason: 'outside_window' } ) ] );
		gameplay.candidates( frame( pointLook( 0, 0.2, - 2 ) ) );
		expect( gameplay.actorMarks.has( 'quest:q_side:talk' ) ).toBe( false );

		actions.places.mockReturnValue( [] );
		gameplay.candidates( frame( pointLook( 0, 0.2, - 2 ) ) );
		expect( gameplay.group.children ).toHaveLength( 0 );

	} );

	it( 'gives one shared character the appointment the player is approaching', () => {

		const target = ( questId, parcelId ) => ( {
			targetKey: `quest:${questId}:talk`, questId, stepId: 'talk', kind: 'talk', title: questId, text: 'Meet the contact.',
			place: { kind: 'parcel', id: parcelId }, actorIds: [ 'same-person' ], venue: null, window: null, availability: { available: true }
		} );
		const actions = { targets: () => [], places: () => [ target( 'main', 'far' ), target( 'side', 'near' ) ] };
		const body = { position: new THREE.Vector3( 0, 0, - 2 ) };
		const crowd = { castMember: vi.fn( () => body ) };
		const gameplay = setup( actions, { crowd } );
		gameplay.anchors.set( 'far', new THREE.Vector3( 20, 0, - 2 ) );
		gameplay.anchors.set( 'near', body.position.clone() );

		gameplay.candidates( frame( pointLook( 0, 1.3, - 2 ) ) );
		expect( crowd.castMember ).toHaveBeenCalledTimes( 1 );
		expect( crowd.castMember ).toHaveBeenCalledWith( 'same-person', 600, expect.any( THREE.Vector3 ), 'near' );
		expect( gameplay.actorMarks.has( 'quest:side:talk' ) ).toBe( true );
		expect( gameplay.actorMarks.has( 'quest:main:talk' ) ).toBe( false );

	} );

	it( 'routes an area prompt through QuestActions at the player place', () => {

		const place = { kind: 'district', id: 'd0' };
		const target = questTarget( 'observe', [ action( 'inspect', 'inspect' ) ], place );
		const actions = fakeActions( target );
		const gameplay = setup( actions );
		const candidate = gameplay.candidates( frame( new THREE.Vector3( 0, 0, - 1 ), [ place ] ) )[ 0 ];

		expect( candidate.kind ).toBe( 'quest' );
		gameplay.perform( perform( candidate ) );
		expect( actions.perform ).toHaveBeenCalledWith( expect.objectContaining( { action: 'inspect', playerPlaces: [ place ] } ) );

		// A marked area is scored by the crosshair, so looking at the mark beats
		// whoever is walking past it instead of tying with them.
		const marked = fakeActions( questTarget( 'work', [ action( 'work', 'Start work' ) ] ) );
		const standing = setup( marked );
		const away = standing.candidates( frame( pointLook( 0, 1.7, 2 ) ) )[ 0 ];
		const looking = standing.candidates( frame( pointLook( 0, CHEST, - 2 ) ) )[ 0 ];
		expect( away.aim ).toBeCloseTo( 0.76 );
		expect( looking.aim ).toBeGreaterThan( away.aim );

	} );

	it( 'requires the exact cast actors and an unobstructed focus, and animates only an accepted action', () => {

		const members = [
			{ npcId: 'cast-a', position: new THREE.Vector3( - 0.3, 0, - 2 ) },
			{ npcId: 'cast-b', position: new THREE.Vector3( 0.3, 0, - 2 ) }
		];
		const actorIds = members.map( ( member ) => member.npcId );
		const target = { ...questTarget( 'listen', [ action( 'listen', 'Listen' ) ] ), actorIds };
		const actions = fakeActions( target );
		const animations = { questInteraction: vi.fn() };
		const crowd = {
			questMember: vi.fn( ( npcId ) => members.find( ( member ) => member.npcId === npcId ) ),
			castMember: vi.fn( ( npcId ) => members.find( ( member ) => member.npcId === npcId ) )
		};
		const gameplay = setup( actions, { animations, crowd } );
		const look = pointLook( 0, 1.3, - 2 );
		const candidate = gameplay.candidates( frame( look ) )[ 0 ];

		expect( crowd.questMember.mock.calls.map( ( call ) => call[ 0 ] ) ).toEqual( actorIds );
		gameplay.perform( perform( candidate ) );
		expect( actions.perform ).toHaveBeenCalledWith( expect.objectContaining( { action: 'listen', focus: expect.any( Object ) } ) );
		expect( animations.questInteraction ).toHaveBeenCalledWith( { targetKey: target.targetKey, action: 'listen', members } );

		actions.perform.mockReturnValueOnce( { ...result( 'listen' ), ok: false } );
		gameplay.perform( perform( candidate ) );
		expect( animations.questInteraction ).toHaveBeenCalledOnce();

		const blocked = setup( fakeActions( target ), { crowd, blocked: true } );
		expect( blocked.candidates( frame( look ) ) ).toEqual( [] );

	} );

	it.each( [ 'listen', 'steal' ] )( 'offers %s through impact sensors while solid walls, doors and props still block it', async ( kind ) => {

		const physics = await Physics.create();
		const impacts = new ImpactWorld( physics );
		const members = [
			{ id: 'body-a', npcId: 'cast-a', position: new THREE.Vector3( - 0.3, 0, - 1.5 ) },
			{ id: 'body-b', npcId: 'cast-b', position: new THREE.Vector3( 0.3, 0, - 1.5 ) }
		].slice( 0, kind === 'listen' ? 2 : 1 );
		impacts.sync( { people: members, vehicles: [] } );
		physics.world.step();
		const target = { ...questTarget( kind, [ action( kind, kind ) ] ), actorIds: members.map( member => member.npcId ) };
		const crowd = {
			questMember: npcId => members.find( member => member.npcId === npcId ),
			castMember: npcId => members.find( member => member.npcId === npcId )
		};
		const gameplay = setup( fakeActions( target ), { physics, playerCollider: null, crowd } );
		const look = pointLook( 0, CHEST, - 1.5 );
		const to = members[ 0 ].position.clone().setY( CHEST ).sub( EYE );
		const distance = to.length();
		const hit = physics.world.castRay( new physics.rapier.Ray( EYE, to.normalize() ), distance - 0.25, true );
		expect( hit.collider.isSensor() ).toBe( true );
		expect( gameplay.candidates( frame( look ) ) ).toHaveLength( 1 );

		for ( const [ label, size ] of [ [ 'wall', [ 4, 3, 0.1 ] ], [ 'door', [ 1, 2, 0.1 ] ], [ 'prop', [ 0.65, 0.65, 0.65 ] ] ] ) {

			const geometry = new THREE.BoxGeometry( ...size );
			const solid = physics.addKinematicTrimesh( geometry, { x: 0, y: 1.35, z: - 0.7 } );
			physics.world.step();
			expect( gameplay.candidates( frame( look ) ), `${label} occludes the actors` ).toEqual( [] );
			physics.remove( solid );
			geometry.dispose();
			physics.world.step();
			expect( gameplay.candidates( frame( look ) ) ).toHaveLength( 1 );

		}
		impacts.dispose();
		physics.world.free();

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

	it( 'starts and releases follow and crouch only for the selected actual cast npcId', () => {

		const state = { pose: null, follow: null };
		const actor = ( mode, animation = 'walk' ) => ( {
			npcId: 'cast-a', name: { given: 'Ana', family: 'Silva' }, type: 'courier', gender: 'female', appearanceSeed: 8,
			place: { kind: 'edge', id: 'e1' }, position: [ 1, 0, 2 ], heading: 0, animation, mode,
			schedule: { activity: 'commuting', progress: 0.2, nextDestination: { kind: 'parcel', id: 'p9' } }, visible: true
		} );
		const continuity = {
			startFollow: vi.fn( () => { state.follow = { npcId: 'cast-a', mode: 'following' }; return actor( 'following' ); } ),
			stopFollow: vi.fn( () => { state.follow = null; return actor( 'resuming' ); } ),
			startCrouch: vi.fn( ( request ) => { state.pose = { npcId: request.npcId, kind: 'crouch' }; return actor( 'posing', 'crouch' ); } ),
			releaseCrouch: vi.fn( () => { state.pose = null; return actor( 'resuming' ); } ),
			serialize: vi.fn( () => structuredClone( state ) )
		};
		const crowd = { questMember: () => null, syncActor: vi.fn() };
		const animations = { npcControl: vi.fn() };
		const gameplay = setup( fakeActions( questTarget( 'observe', [ action( 'inspect', 'Inspect' ) ] ) ), {
			crowd, animations, continuity, session: { hasCastNpc: ( npcId ) => npcId === 'cast-a' }
		} );
		const request = { kind: 'start-follow', npcId: 'cast-a', timeMin: 600, playerPosition: { x: 3, y: 0, z: 4 } };

		expect( gameplay.control( request ) ).toEqual( { ok: true, kind: 'start-follow', npcId: 'cast-a', mode: 'following' } );
		expect( continuity.startFollow ).toHaveBeenCalledWith( { npcId: 'cast-a', timeMin: 600, playerPosition: [ 3, 0, 4 ] } );
		expect( crowd.syncActor ).toHaveBeenCalledWith( expect.objectContaining( { npcId: 'cast-a' } ), expect.any( THREE.Vector3 ) );

		expect( gameplay.control( { ...request, kind: 'release-follow' } ) )
			.toEqual( { ok: true, kind: 'release-follow', npcId: 'cast-a', mode: 'resuming' } );
		expect( continuity.stopFollow ).toHaveBeenCalledWith( { timeMin: 600 } );

		const crouch = { ...request, kind: 'start-crouch' };
		expect( gameplay.control( crouch ) ).toEqual( { ok: true, kind: 'start-crouch', npcId: 'cast-a', mode: 'posing' } );
		expect( continuity.startCrouch ).toHaveBeenCalledWith( { npcId: 'cast-a', timeMin: 600 } );
		expect( animations.npcControl ).toHaveBeenLastCalledWith( crouch, expect.objectContaining( { animation: 'crouch' } ) );

		const release = { ...request, kind: 'release-crouch' };
		expect( gameplay.control( release ) ).toEqual( { ok: true, kind: 'release-crouch', npcId: 'cast-a', mode: 'resuming' } );
		expect( continuity.releaseCrouch ).toHaveBeenCalledWith( { npcId: 'cast-a', timeMin: 600 } );
		expect( animations.npcControl ).toHaveBeenLastCalledWith( release, expect.objectContaining( { animation: 'walk' } ) );

		expect( gameplay.control( { ...crouch, npcId: 'stranger' } ) ).toMatchObject( { ok: false, error: 'not_cast' } );

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
		places: vi.fn( () => [] ),
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
