import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { REQUIRED_CLIPS } from './animation/index.js';
import { GameplayAnimationDirector } from './GameplayAnimationDirector.js';
import { CLIP } from './agents/CharacterAssets.js';
import { crowdClipForName } from './agents/Crowd.js';
import { HeroCharacter } from './agents/HeroCharacter.js';
import { animation as library, outfit, rig as body, rootTurn } from './agents/HeroCharacter.test-fixtures.js';

const CATALOG = Object.freeze( {
	assetId: 'quaternius-universal-animation-library-pro', edition: 'Pro',
	sourceSha256: 'a'.repeat( 64 ), availableClips: REQUIRED_CLIPS
} );

describe( 'live gameplay animation composition', () => {

	it( 'replaces a focused follower with standing rest for the entire open conversation', () => {

		const rig = setup();
		const following = actor( { animation: 'run', mode: 'following' } );
		rig.director.update( [ following ], 0 );
		const conversation = { npcId: following.npcId };
		rig.director.beginConversation( conversation, { ...following, mode: 'conversation' } );
		expect( current( rig.director, following.npcId ) ).toMatchObject( {
			mode: 'routine', action: null, currentClip: 'Idle_Loop', posture: 'standing'
		} );
		expect( lastSegments( rig.hero ) ).toEqual( [ 'Idle_Loop' ] );

		// A previously produced follow snapshot cannot reclaim an open chat.
		rig.director.update( [ following ], 0.1 );
		expect( current( rig.director, following.npcId ).currentClip ).toBe( 'Idle_Loop' );
		rig.director.npcDialogueTurn( conversation );
		rig.director.update( [ following ], 2 );
		expect( lastSegments( rig.hero ) ).toEqual( [ 'Idle_Loop' ] );
		expect( rig.director.snapshot().actions ).toEqual( [] );

		// Closing between turns still updates the focused rig to its resumed
		// routine, even though the timed speaking action has already finished.
		const resumed = { ...following, animation: 'walk', mode: 'resuming' };
		rig.director.endConversation( conversation, resumed );
		expect( lastSegments( rig.hero ) ).toEqual( [ 'Walk_Loop' ] );

	} );

	it( 'keeps a seated conversation pose when schedule snapshots change before and between turns', () => {

		const rig = setup();
		const seated = actor( { animation: 'sit', mode: 'conversation' } );
		const conversation = { npcId: seated.npcId };
		rig.director.beginConversation( conversation, seated );
		const walking = { ...seated, animation: 'walk', mode: 'schedule' };
		rig.director.update( [ walking ], 0.1 );
		expect( lastSegments( rig.hero ) ).toEqual( [ 'Sitting_Idle_Loop' ] );
		rig.director.playerDialogueTurn( conversation );
		expect( lastSegments( rig.hero ) ).toEqual( [ 'Sitting_Nodding_Loop' ] );
		rig.director.npcDialogueTurn( conversation );
		expect( lastSegments( rig.hero ) ).toEqual( [ 'Sitting_Talking_Loop' ] );
		rig.director.update( [ walking ], 2 );
		expect( current( rig.director, seated.npcId ) ).toMatchObject( {
			currentClip: 'Sitting_Idle_Loop', posture: 'seated'
		} );
		expect( lastSegments( rig.hero ) ).toEqual( [ 'Sitting_Idle_Loop' ] );
		expect( rig.crowd.setAnimationClip.mock.calls.some( ( [ , clip ] ) => clip === 'Walk_Loop' ) ).toBe( false );

	} );

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

	it( 'holds the NPC talking while their voice plays, and never over the player\'s turn', () => {

		const rig = setup();
		const scheduled = actor( { animation: 'sit', mode: 'schedule' } );
		rig.director.update( [ scheduled ], 0 );
		const conversation = { npcId: scheduled.npcId };
		rig.director.beginConversation( conversation, { ...scheduled, mode: 'conversation' } );
		const talking = () => current( rig.director, scheduled.npcId ).currentClip;

		rig.director.npcDialogueTurn( conversation );
		rig.director.holdDialogueTurn( conversation, 5 );
		rig.director.update( [ scheduled ], 4 );
		expect( talking() ).toBe( 'Sitting_Talking_Loop' );
		rig.director.holdDialogueTurn( conversation, 0.5 );
		rig.director.update( [ scheduled ], 1.1 );
		expect( talking() ).toBe( 'Sitting_Idle_Loop' );

		rig.director.holdDialogueTurn( conversation, 3 );
		expect( talking() ).toBe( 'Sitting_Talking_Loop' );
		rig.director.update( [ scheduled ], 2.9 );
		expect( talking() ).toBe( 'Sitting_Talking_Loop' );

		rig.director.playerDialogueTurn( conversation );
		expect( rig.director.holdDialogueTurn( conversation, 3 ) ).toBeNull();
		expect( talking() ).toBe( 'Sitting_Nodding_Loop' );
		expect( rig.director.holdDialogueTurn( { npcId: 'stranger' }, 3 ) ).toBeNull();

		// Whose voice plays reaches the focused rig, which moves its head to it.
		const speech = { seed: 7, loudness: () => 0.1 };
		rig.director.speaking( conversation, speech );
		rig.director.speaking( conversation, null );
		expect( rig.hero.speak.mock.calls ).toEqual( [ [ scheduled.npcId, speech ], [ scheduled.npcId, null ] ] );

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

	it( 'presents a leader as a companion: walking ahead, standing while it waits or has arrived, and back after a chat', () => {

		const rig = setup();
		const leading = actor( { animation: 'walk', mode: 'leading' } );
		rig.director.update( [ leading ], 0 );
		expect( current( rig.director, leading.npcId ) ).toMatchObject( { action: 'follow-walk', currentClip: 'Walk_Loop' } );
		const waiting = { ...leading, animation: 'idle' };
		rig.director.update( [ waiting ], 0.1 );
		expect( current( rig.director, leading.npcId ) ).toMatchObject( { action: 'idle', currentClip: 'Idle_Loop' } );

		// Turning to following where it stands keeps the action it is in.
		const dispatched = rig.crowd.setAnimationClip.mock.calls.length;
		rig.director.update( [ { ...waiting, mode: 'following' } ], 0.1 );
		expect( rig.crowd.setAnimationClip.mock.calls.length ).toBe( dispatched );

		const conversation = { npcId: leading.npcId };
		rig.director.beginConversation( conversation, { ...waiting, mode: 'conversation' } );
		rig.director.endConversation( conversation, leading );
		expect( current( rig.director, leading.npcId ) ).toMatchObject( { action: 'follow-walk', currentClip: 'Walk_Loop' } );

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

	it( 'hands a new focused rig the pose its crowd body shows, and gives the body its clip once the rig has the slot', async () => {

		// A walker a quarter into its stride goes still to talk: the rig starts
		// in the walk where the body is and blends into standing.
		const walking = focusedRig( CLIP.WALK );
		walking.director.update( [ actor( { animation: 'walk' } ) ], 0 );
		walking.director.beginConversation( { npcId: 'npc-1' }, actor( { mode: 'conversation' } ) );
		expect( walking.person.clip ).toBe( CLIP.WALK );
		await vi.waitFor( () => expect( walking.person.clip ).toBe( CLIP.IDLE ) );
		expect( walking.switched.at( - 1 ) ).toEqual( [ 'Idle_Loop', true ] );
		walking.hero.update( 0 );
		expect( rootTurn( walking.hero.active.root ) ).toBeCloseTo( - 0.75, 6 );
		walking.hero.update( 0.2 );
		expect( rootTurn( walking.hero.active.root ) ).toBeCloseTo( 0, 6 );

		// A standing body asked to crouch: the rig stands where the body stands
		// and plays the whole entry down, not the crouch it ends in first.
		const standing = focusedRig( CLIP.IDLE );
		standing.director.npcControl( { kind: 'start-crouch' }, actor( { animation: 'crouch', mode: 'posing' } ) );
		expect( standing.person.clip ).toBe( CLIP.IDLE );
		await vi.waitFor( () => expect( standing.person.clip ).toBe( CLIP.CROUCH ) );
		expect( standing.switched.at( - 1 ) ).toEqual( [ 'Crouch_Idle_Loop', true ] );
		const turns = [];
		standing.hero.update( 0 );
		turns.push( rootTurn( standing.hero.active.root ) );
		for ( let frame = 1; frame <= 30; frame ++ ) {

			standing.hero.update( 1 / 60 );
			turns.push( rootTurn( standing.hero.active.root ) );

		}
		expect( turns[ 0 ] ).toBeCloseTo( 0, 6 );
		turns.forEach( ( turn, frame ) => expect( turn ).toBeLessThanOrEqual( frame / 60 + 1e-6 ) );

	} );

	it( 'gives a focused body a clip a later render sets over the one it was to take after the rig load', async () => {

		const rig = setup( [ member( 'npc-1', 1 ) ] );
		const loads = [];
		rig.hero.show.mockImplementation( () => new Promise( ( resolve ) => loads.push( resolve ) ) );
		rig.director.npcControl( { kind: 'start-crouch' }, actor( { animation: 'crouch', mode: 'posing' } ) );
		rig.director.npcControl( { kind: 'release-crouch' }, actor( { animation: 'sit', mode: 'resuming' } ) );
		expect( rig.crowd.setAnimationClip ).not.toHaveBeenCalledWith( 'npc-1', 'Crouch_Idle_Loop' );
		expect( rig.crowd.setAnimationClip ).not.toHaveBeenCalledWith( 'npc-1', 'Sitting_Idle_Loop' );

		// The body walks on, unfocused, before either load has finished.
		rig.director.update( [ actor( { animation: 'walk' } ) ], 0.1 );
		expect( rig.crowd.setAnimationClip ).toHaveBeenLastCalledWith( 'npc-1', 'Walk_Loop' );
		for ( const loaded of loads ) loaded( true );
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
		expect( rig.crowd.setAnimationClip ).toHaveBeenLastCalledWith( 'npc-1', 'Walk_Loop' );

	} );

} );

/**
 * A director over a real focused rig and one crowd body a quarter into its
 * clip (frame 8). Walking leans the root back from one radian to none over
 * the loop, the crouch entry bends it a radian forward over its second and
 * everything else stands upright. `switched` records each clip the body is
 * given and whether the rig had its slot by then.
 */
function focusedRig( clip ) {

	const animation = library( {
		...Object.fromEntries( REQUIRED_CLIPS.map( ( name ) => [ name, [ 0, 0 ] ] ) ),
		Walk_Loop: [ - 1, 0 ], Crouch_Enter: [ 0, 1 ], Crouch_Idle_Loop: [ 1, 1 ]
	} );
	const hero = new HeroCharacter( { animation, loadModel: () => ( { scene: body( 'body' ) } ) } );
	const person = {
		npcId: 'npc-1', gender: 'male', variant: 0, appearanceSeed: 3, clip, frame: 8, hero: false,
		position: new THREE.Vector3(), heading: 0, look: outfit()
	};
	const switched = [];
	const crowd = {
		memberForNpc: ( npcId ) => npcId === person.npcId ? person : null,
		setAnimationClip: ( npcId, clipName ) => {

			switched.push( [ clipName, hero.active?.person === person ] );
			person.clip = crowdClipForName( clipName );

		}
	};
	const director = new GameplayAnimationDirector( { catalog: CATALOG, animation, crowd, hero } );
	return { director, hero, person, switched };

}

function setup( members = [ member( 'npc-1', 3 ) ] ) {

	const byId = new Map( members.map( ( value ) => [ value.npcId, value ] ) );
	const crowd = {
		setAnimationClip: vi.fn(),
		memberForNpc: vi.fn( ( npcId ) => byId.get( npcId ) ?? null )
	};
	const hero = { show: vi.fn( () => true ), hide: vi.fn(), speak: vi.fn() };
	const animation = { animations: REQUIRED_CLIPS.map( ( name ) => ( { name, duration: 0.5 } ) ) };
	const director = new GameplayAnimationDirector( { catalog: CATALOG, animation, crowd, hero } );
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
