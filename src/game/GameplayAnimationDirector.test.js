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
			action: 'talk', currentClip: 'Sitting_Talking_Loop', posture: 'seated'
		} );
		expect( current( rig.director, 'player' ) ).toMatchObject( { action: 'listen', currentClip: 'Idle_Loop' } );
		expect( lastSegments( rig.hero ) ).toEqual( [ 'Sitting_Talking_Loop' ] );

		rig.director.playerDialogueTurn( conversation );
		expect( current( rig.director, scheduled.npcId ) ).toMatchObject( {
			action: 'listen', currentClip: 'Sitting_Nodding_Loop'
		} );
		expect( current( rig.director, 'player' ) ).toMatchObject( { action: 'talk', currentClip: 'Idle_Talking_Loop' } );
		expect( lastSegments( rig.hero ) ).toEqual( [ 'Sitting_Nodding_Loop' ] );

		rig.director.npcDialogueTurn( conversation );
		expect( current( rig.director, scheduled.npcId ).currentClip ).toBe( 'Sitting_Talking_Loop' );
		const resumed = { ...scheduled, animation: 'walk', mode: 'resuming' };
		rig.director.endConversation( conversation, resumed );
		expect( current( rig.director, scheduled.npcId ) ).toMatchObject( {
			mode: 'routine', action: null, currentClip: 'Walk_Loop', routine: { activity: 'travel' }
		} );
		expect( rig.director.snapshot().actions ).toEqual( [] );
		expect( lastSegments( rig.hero ) ).toEqual( [ 'Walk_Loop' ] );

	} );

	it( 'switches a follower through sprint, walk, stop, and deterministic routine resume', () => {

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

	} );

	it.each( [
		[ 'take', 'pickup-ground', 'pickup' ], [ 'read', 'read', 'read' ],
		[ 'inspect', 'observe', 'observe' ], [ 'steal', 'steal-ground', 'steal' ],
		[ 'work', 'work-interact', 'work' ], [ 'deliver', 'deliver', 'deliver' ]
	] )( 'coordinates an accepted %s quest action as %s', ( action, variant, stateAction ) => {

		const rig = setup();
		const started = rig.director.questInteraction( { targetKey: `quest:q:${action}`, action } );
		expect( started.variant ).toBe( variant );
		expect( current( rig.director, 'player' ).action ).toBe( stateAction );
		rig.director.update( [], 10 );
		expect( current( rig.director, 'player' ) ).toMatchObject( { mode: 'routine', currentClip: 'Idle_Loop' } );
		expect( rig.director.snapshot().actions ).toEqual( [] );

	} );

	it( 'coordinates quest listening as one speaker and all sorted listeners', () => {

		const members = [ member( 'cast-b', 0 ), member( 'cast-a', 3 ) ];
		const rig = setup( members );
		const started = rig.director.questInteraction( { targetKey: 'quest:q:listen', action: 'listen', members } );
		const action = rig.director.snapshot().actions[ 0 ];

		expect( started.variant ).toBe( 'listen' );
		expect( action.participants ).toEqual( [ 'cast-a', 'cast-b', 'player' ] );
		expect( current( rig.director, 'cast-b' ).currentClip ).toBe( 'Idle_Talking_Loop' );
		expect( current( rig.director, 'cast-a' ).currentClip ).toBe( 'Sitting_Nodding_Loop' );
		expect( lastSegments( rig.hero ) ).toEqual( [ 'Idle_Talking_Loop' ] );

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
