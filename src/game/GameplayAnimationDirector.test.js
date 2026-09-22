import { describe, expect, it, vi } from 'vitest';
import { REQUIRED_CLIPS } from './animation/index.js';
import { GameplayAnimationDirector } from './GameplayAnimationDirector.js';

describe( 'live gameplay animation composition', () => {

	it( 'changes speaker and listener roles atomically, then resumes the latest NPC routine', () => {

		const rig = setup();
		const scheduled = actor( { animation: 'sit', mode: 'schedule' } );
		rig.director.update( [ scheduled ], 0 );
		const conversation = { npcId: scheduled.npcId };
		rig.director.beginConversation( conversation, { ...scheduled, mode: 'conversation' } );

		expect( current( rig.director, scheduled.npcId ) ).toMatchObject( {
			action: null, currentClip: 'Sitting_Idle_Loop', posture: 'seated'
		} );
		expect( rig.director.snapshot().actions ).toEqual( [] );

		rig.director.playerDialogueTurn( conversation );
		expect( current( rig.director, scheduled.npcId ) ).toMatchObject( {
			action: 'listen', currentClip: 'Sitting_Nodding_Loop'
		} );
		expect( current( rig.director, 'player' ) ).toMatchObject( { action: 'talk', currentClip: 'Idle_Talking_Loop' } );
		expect( lastSegments( rig.hero ) ).toEqual( [ 'Sitting_Nodding_Loop' ] );

		rig.director.npcDialogueTurn( conversation );
		expect( current( rig.director, scheduled.npcId ).currentClip ).toBe( 'Sitting_Talking_Loop' );
		rig.director.update( [ scheduled ], 1.8 );
		expect( current( rig.director, scheduled.npcId ).currentClip ).toBe( 'Sitting_Idle_Loop' );
		expect( rig.director.snapshot().actions ).toEqual( [] );
		rig.director.npcDialogueTurn( conversation );
		const resumed = { ...scheduled, animation: 'walk', mode: 'resuming' };
		rig.director.endConversation( conversation, resumed );
		expect( current( rig.director, scheduled.npcId ) ).toMatchObject( {
			mode: 'routine', action: null, currentClip: 'Walk_Loop', routine: { activity: 'travel' }
		} );
		expect( rig.director.snapshot().actions ).toEqual( [] );
		expect( lastSegments( rig.hero ) ).toEqual( [ 'Walk_Loop' ] );

	} );

	it( 'interrupts the exact NPC action for physics and holds routine projection until release', () => {

		const rig = setup();
		const scheduled = actor( { animation: 'sit', mode: 'schedule' } );
		rig.director.update( [ scheduled ], 0 );
		const conversation = { npcId: scheduled.npcId };
		rig.director.beginConversation( conversation, { ...scheduled, mode: 'conversation' } );
		rig.director.npcDialogueTurn( conversation );

		const interrupted = rig.director.physicsInterrupt( { npcId: scheduled.npcId } );
		expect( interrupted.events ).toContainEqual( expect.objectContaining( {
			type: 'action-interrupted', reason: 'physics', actorIds: [ scheduled.npcId, 'player' ]
		} ) );
		expect( rig.director.snapshot().actions ).toEqual( [] );
		expect( current( rig.director, scheduled.npcId ) ).toMatchObject( {
			mode: 'routine', currentClip: 'Sitting_Idle_Loop'
		} );

		const renders = rig.crowd.setAnimationClip.mock.calls.length;
		rig.director.update( [ { ...scheduled, animation: 'walk', mode: 'resuming' } ], 1 );
		expect( rig.crowd.setAnimationClip.mock.calls ).toHaveLength( renders );
		expect( rig.director.physicsResume( { npcId: scheduled.npcId } ) ).toBe( true );
		rig.director.update( [ { ...scheduled, animation: 'walk', mode: 'resuming' } ], 0 );
		expect( current( rig.director, scheduled.npcId ).currentClip ).toBe( 'Walk_Loop' );

	} );

	it( 'switches a follower through sprint, walk, stop, explicit crouch and deterministic routine resume', () => {

		const rig = setup();
		const running = actor( { animation: 'run', mode: 'following' } );
		rig.director.update( [ running ], 0 );
		expect( current( rig.director, running.npcId ) ).toMatchObject( {
			action: 'follow-sprint', currentClip: 'Sprint_Loop'
		} );
		expect( lastSegments( rig.hero ) ).toEqual( [ 'Sprint_Enter', 'Sprint_Loop' ] );

		const walking = { ...running, animation: 'walk' };
		rig.director.update( [ walking ], 0.1 );
		expect( current( rig.director, running.npcId ) ).toMatchObject( {
			action: 'follow-walk', currentClip: 'Walk_Loop'
		} );
		expect( lastSegments( rig.hero ) ).toEqual( [ 'Walk_Loop' ] );

		const stopped = { ...running, animation: 'idle' };
		rig.director.update( [ stopped ], 0.1 );
		expect( current( rig.director, running.npcId ).action ).toBe( 'idle' );
		const resuming = { ...running, animation: 'walk', mode: 'resuming' };
		rig.director.update( [ resuming ], 0.1 );
		expect( current( rig.director, running.npcId ) ).toMatchObject( {
			mode: 'routine', action: null, currentClip: 'Walk_Loop'
		} );
		expect( rig.director.snapshot().actions ).toEqual( [] );

		const crouched = actor( { animation: 'crouch', mode: 'posing' } );
		rig.director.npcControl( { kind: 'start-crouch', npcId: crouched.npcId }, crouched );
		expect( current( rig.director, crouched.npcId ) ).toMatchObject( {
			action: 'crouch', posture: 'crouched', currentClip: 'Crouch_Idle_Loop'
		} );
		expect( lastSegments( rig.hero ) ).toEqual( [ 'Crouch_Enter', 'Crouch_Idle_Loop' ] );

		rig.director.npcControl( { kind: 'release-crouch', npcId: resuming.npcId }, resuming );
		expect( current( rig.director, resuming.npcId ) ).toMatchObject( {
			mode: 'routine', action: null, currentClip: 'Walk_Loop'
		} );
		expect( lastSegments( rig.hero ) ).toEqual( [ 'Crouch_Exit', 'Walk_Loop' ] );

	} );

	it( 'keeps standing and seated quest holds in their authored pose instead of treating all holds as crouches', () => {

		const rig = setup();
		const standing = actor( { animation: 'idle', mode: 'posing' } );
		rig.director.update( [ standing ], 0 );
		expect( current( rig.director, standing.npcId ) ).toMatchObject( {
			mode: 'routine', action: null, posture: 'standing', currentClip: 'Idle_Loop'
		} );
		expect( rig.director.snapshot().actions ).toEqual( [] );
		const seated = { ...standing, animation: 'sit' };
		rig.director.update( [ seated ], 0.1 );
		expect( current( rig.director, seated.npcId ) ).toMatchObject( {
			mode: 'routine', action: null, posture: 'seated', currentClip: 'Sitting_Idle_Loop'
		} );
		expect( rig.director.snapshot().actions ).toEqual( [] );
		// A previously explicit crouch also settles when a new ordinary hold
		// takes over that same identity.
		rig.director.update( [ { ...standing, animation: 'crouch' } ], 0.1 );
		expect( current( rig.director, standing.npcId ).currentClip ).toBe( 'Crouch_Idle_Loop' );
		rig.director.update( [ standing ], 0.1 );
		expect( current( rig.director, standing.npcId ) ).toMatchObject( { mode: 'routine', action: null, currentClip: 'Idle_Loop' } );

	} );

	it( 'coordinates an accepted quest action, and listening as one speaker with all sorted listeners', () => {

		const rig = setup();
		const started = rig.director.questInteraction( { targetKey: 'quest:q:take', action: 'take' } );

		expect( started.variant ).toBe( 'pickup-ground' );
		expect( current( rig.director, 'player' ).action ).toBe( 'pickup' );
		rig.director.update( [], 10 );
		expect( current( rig.director, 'player' ) ).toMatchObject( { mode: 'routine', currentClip: 'Idle_Loop' } );
		expect( rig.director.snapshot().actions ).toEqual( [] );

		const members = [ member( 'cast-b', 0 ), member( 'cast-a', 3 ) ];
		const listening = setup( members );
		const heard = listening.director.questInteraction( { targetKey: 'quest:q:listen', action: 'listen', members } );
		const action = listening.director.snapshot().actions[ 0 ];

		expect( heard.variant ).toBe( 'listen' );
		expect( action.participants ).toEqual( [ 'cast-a', 'cast-b', 'player' ] );
		expect( current( listening.director, 'cast-b' ).currentClip ).toBe( 'Idle_Talking_Loop' );
		expect( current( listening.director, 'cast-a' ).currentClip ).toBe( 'Sitting_Nodding_Loop' );
		expect( lastSegments( listening.hero ) ).toEqual( [ 'Idle_Talking_Loop' ] );

	} );

} );

function setup( members = [ member( 'npc-1', 3 ) ] ) {

	const byId = new Map( members.map( ( value ) => [ value.npcId, value ] ) );
	const crowd = {
		setAnimationClip: vi.fn(),
		memberForNpc: vi.fn( ( npcId ) => byId.get( npcId ) ?? null )
	};
	const hero = { show: vi.fn( () => true ), hide: vi.fn() };
	const animation = { animations: REQUIRED_CLIPS.map( ( name ) => ( { name, duration: 0.5 } ) ) };
	const director = new GameplayAnimationDirector( {
		catalog: {
			assetId: 'quaternius-universal-animation-library-pro', edition: 'Pro',
			sourceSha256: 'a'.repeat( 64 ), availableClips: [ ...REQUIRED_CLIPS ]
		},
		animation, crowd, hero
	} );
	return { director, crowd, hero };

}

function actor( overrides ) {

	return {
		npcId: 'npc-1', animation: 'idle', mode: 'schedule', visible: true,
		schedule: { entryIndex: 4 }, ...overrides
	};

}

function member( npcId, clip ) {

	return { npcId, clip, gender: 'female', appearanceSeed: 9, position: {}, heading: 0, look: {} };

}

function current( director, actorId ) {

	return director.snapshot().actors.find( ( actorState ) => actorState.actorId === actorId );

}

function lastSegments( hero ) {

	return hero.show.mock.calls.at( -1 )[ 1 ].map( ( segment ) => segment.clipName );

}
