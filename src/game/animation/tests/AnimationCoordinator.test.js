import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { AnimationCoordinator, AnimationCoordinationError, REQUIRED_CLIPS } from '../index.js';

const configUrl = new URL( '../fixtures/pro-coordinator-config.json', import.meta.url );
const lifecycleUrl = new URL( '../fixtures/dialogue-lifecycle.json', import.meta.url );

async function fixture( url ) {

	return JSON.parse( await readFile( url, 'utf8' ) );

}

function questCommand( variant, actionId = `action:${variant}` ) {

	return {
		version: '1',
		commandId: `command:${variant}`,
		kind: 'quest-action',
		actionId,
		actorId: 'npc-mara',
		variant
	};

}

describe( 'AnimationCoordinator', () => {

	it( 'audits every required quest clip before accepting a catalog', async () => {

		const config = await fixture( configUrl );
		config.catalog.availableClips = config.catalog.availableClips.filter( ( name ) => name !== 'Idle_Paper' );

		expect( () => new AnimationCoordinator( config ) ).toThrowError( expect.objectContaining( {
			name: 'AnimationCoordinationError',
			code: 'E_ANIMATION_CATALOG',
			details: [ 'Idle_Paper' ]
		} ) );

	} );

	it( 'reports the selected names from the installed Pro library', async () => {

		const coordinator = new AnimationCoordinator( await fixture( configUrl ) );
		const report = coordinator.requirements();

		expect( report.assetId ).toBe( 'quaternius-universal-animation-library-pro' );
		expect( report.edition ).toBe( 'Pro' );
		expect( report.requiredClips ).toEqual( REQUIRED_CLIPS );
		expect( report.requiredClips ).toHaveLength( 25 );

	} );

	it.each( [
		[ 'idle', 'idle', 'Idle_Loop', 'explicit' ],
		[ 'sit', 'sit', 'Sitting_Idle_Loop', 'explicit' ],
		[ 'pickup-ground', 'pickup', 'PickUp_Kneeling', 'clip-end' ],
		[ 'pickup-table', 'pickup', 'PickUp_Table', 'clip-end' ],
		[ 'read', 'read', 'Idle_Paper', 'clip-end' ],
		[ 'observe', 'observe', 'Idle_LookAround_Loop', 'explicit' ],
		[ 'steal-ground', 'steal', 'PickUp_Kneeling', 'clip-end' ],
		[ 'steal-table', 'steal', 'PickUp_Table', 'clip-end' ],
		[ 'work-counter', 'work', 'Counter_Idle_Loop', 'explicit' ],
		[ 'work-repair', 'work', 'Fixing_Kneeling', 'clip-end' ],
		[ 'work-interact', 'work', 'Interact', 'clip-end' ],
		[ 'deliver', 'deliver', 'Counter_Give', 'clip-end' ],
		[ 'follow-walk', 'follow-walk', 'Walk_Loop', 'explicit' ],
		[ 'follow-sprint', 'follow-sprint', 'Sprint_Loop', 'explicit' ],
		[ 'crouch-idle', 'crouch', 'Crouch_Idle_Loop', 'explicit' ],
		[ 'crouch-forward', 'crouch', 'Crouch_Fwd_Loop', 'explicit' ]
	] )( 'maps %s to real clip state', async ( variant, action, terminalClip, completion ) => {

		const coordinator = new AnimationCoordinator( await fixture( configUrl ) );
		const result = coordinator.dispatch( questCommand( variant ) );
		const actor = result.state.actors.find( ( candidate ) => candidate.actorId === 'npc-mara' );

		expect( actor ).toMatchObject( {
			mode: 'quest',
			action,
			completion,
			currentClip: terminalClip,
			resumePending: true
		} );
		expect( result.transitions[ 0 ].terminalClip ).toBe( terminalClip );
		expect( result.events[ 0 ].type ).toBe( 'quest-action-started' );

	} );

	it( 'coordinates standing talking with seated listening atomically', async () => {

		const coordinator = new AnimationCoordinator( await fixture( configUrl ) );
		const result = coordinator.dispatch( {
			version: '1',
			commandId: 'command:dialogue',
			kind: 'dialogue-turn',
			actionId: 'dialogue:turn-1',
			speakerId: 'npc-mara',
			listenerIds: [ 'npc-ivo' ]
		} );

		expect( result.transitions ).toEqual( [
			expect.objectContaining( { actorId: 'npc-mara', terminalClip: 'Idle_Talking_Loop' } ),
			expect.objectContaining( { actorId: 'npc-ivo', terminalClip: 'Sitting_Nodding_Loop' } )
		] );
		expect( result.state.actors.find( ( actor ) => actor.actorId === 'npc-mara' ) ).toMatchObject( {
			action: 'talk',
			posture: 'standing'
		} );
		expect( result.state.actors.find( ( actor ) => actor.actorId === 'npc-ivo' ) ).toMatchObject( {
			action: 'listen',
			posture: 'seated'
		} );
		expect( result.state.actions[ 0 ].participants ).toEqual( [ 'npc-ivo', 'npc-mara' ] );

	} );

	it( 'completes a deep action through its exit before waiting for routine resume', async () => {

		const coordinator = new AnimationCoordinator( await fixture( configUrl ) );
		coordinator.dispatch( questCommand( 'follow-sprint', 'follow:escort-1' ) );
		const completed = coordinator.dispatch( {
			version: '1',
			commandId: 'command:complete-follow',
			kind: 'complete',
			actionId: 'follow:escort-1'
		} );

		expect( completed.transitions[ 0 ].segments.map( ( segment ) => segment.clipName ) ).toEqual( [
			'Sprint_Exit',
			'Idle_Loop'
		] );
		expect( completed.state.actors.find( ( actor ) => actor.actorId === 'npc-mara' ) ).toMatchObject( {
			mode: 'completed',
			action: 'follow-sprint',
			currentClip: 'Idle_Loop',
			resumePending: true
		} );
		expect( completed.state.actions[ 0 ].status ).toBe( 'completed' );

		const resumed = coordinator.dispatch( {
			version: '1',
			commandId: 'command:resume-follow',
			kind: 'resume-routine',
			actionId: 'follow:escort-1'
		} );

		expect( resumed.transitions[ 0 ].terminalClip ).toBe( 'Counter_Idle_Loop' );
		expect( resumed.state.actions ).toEqual( [] );
		expect( resumed.state.actors.find( ( actor ) => actor.actorId === 'npc-mara' ) ).toMatchObject( {
			mode: 'routine',
			actionId: null,
			action: null,
			currentClip: 'Counter_Idle_Loop',
			resumePending: false
		} );

	} );

	it( 'interrupts every participant in a dialogue and resumes their exact routines', async () => {

		const coordinator = new AnimationCoordinator( await fixture( configUrl ) );
		const commands = await fixture( lifecycleUrl );
		coordinator.dispatch( commands[ 0 ] );
		const interrupted = coordinator.dispatch( commands[ 1 ] );

		expect( interrupted.events[ 0 ] ).toEqual( {
			type: 'action-interrupted',
			actionId: 'quest-main:step-3:turn-1',
			actorIds: [ 'npc-ivo', 'npc-mara' ],
			reason: 'player-left'
		} );
		expect( interrupted.transitions.map( ( entry ) => entry.terminalClip ) ).toEqual( [
			'Sitting_Idle_Loop',
			'Idle_Loop'
		] );

		const resumed = coordinator.dispatch( commands[ 2 ] );
		expect( resumed.transitions ).toEqual( [
			expect.objectContaining( { actorId: 'npc-ivo', terminalClip: 'Sitting_Idle_Loop' } ),
			expect.objectContaining( { actorId: 'npc-mara', terminalClip: 'Counter_Idle_Loop' } )
		] );

	} );

	it( 'uses a schedule update received during an action when the NPC resumes', async () => {

		const coordinator = new AnimationCoordinator( await fixture( configUrl ) );
		coordinator.dispatch( questCommand( 'observe', 'observe:district' ) );
		const synchronized = coordinator.dispatch( {
			version: '1',
			commandId: 'command:sync-next-routine',
			kind: 'sync-routine',
			actorId: 'npc-mara',
			routine: {
				routineId: 'mara-walk-home',
				activity: 'walk',
				posture: 'standing',
				clipName: 'Walk_Loop',
				loop: true
			}
		} );

		expect( synchronized.transitions ).toEqual( [] );
		expect( synchronized.state.actors.find( ( actor ) => actor.actorId === 'npc-mara' ).currentClip ).toBe( 'Idle_LookAround_Loop' );

		coordinator.dispatch( {
			version: '1',
			commandId: 'command:complete-observe',
			kind: 'complete',
			actionId: 'observe:district'
		} );
		const resumed = coordinator.dispatch( {
			version: '1',
			commandId: 'command:resume-observe',
			kind: 'resume-routine',
			actionId: 'observe:district'
		} );

		expect( resumed.transitions[ 0 ].terminalClip ).toBe( 'Walk_Loop' );

	} );

	it( 'round trips interrupted state without losing coordination', async () => {

		const config = await fixture( configUrl );
		const first = new AnimationCoordinator( config );
		first.dispatch( questCommand( 'crouch-forward', 'crouch:cover' ) );
		first.dispatch( {
			version: '1',
			commandId: 'command:physics-interrupt',
			kind: 'interrupt',
			actionId: 'crouch:cover',
			reason: 'physics'
		} );

		const restored = new AnimationCoordinator( config );
		expect( restored.restore( first.snapshot() ) ).toEqual( first.snapshot() );
		const resumed = restored.dispatch( {
			version: '1',
			commandId: 'command:resume-after-physics',
			kind: 'resume-routine',
			actionId: 'crouch:cover'
		} );
		expect( resumed.state.actions ).toEqual( [] );

	} );

	it( 'rejects a restored action whose actor state cannot resume', async () => {

		const config = await fixture( configUrl );
		const first = new AnimationCoordinator( config );
		first.dispatch( questCommand( 'observe', 'observe:restore-check' ) );
		const invalid = first.snapshot();
		invalid.actors.find( ( actor ) => actor.actorId === 'npc-mara' ).resumePending = false;

		const restored = new AnimationCoordinator( config );
		expect( () => restored.restore( invalid ) ).toThrowError( expect.objectContaining( {
			code: 'E_ANIMATION_STATE'
		} ) );

	} );

	it( 'fails closed on invalid commands and conflicting actions', async () => {

		const coordinator = new AnimationCoordinator( await fixture( configUrl ) );

		expect( () => coordinator.dispatch( { version: '1', kind: 'complete' } ) ).toThrowError( expect.objectContaining( {
			code: 'E_ANIMATION_INPUT'
		} ) );

		coordinator.dispatch( questCommand( 'read', 'read:document' ) );
		expect( () => coordinator.dispatch( questCommand( 'idle', 'idle:overlap' ) ) ).toThrowError( expect.objectContaining( {
			code: 'E_ANIMATION_CONFLICT'
		} ) );

		expect( () => coordinator.dispatch( {
			version: '1',
			commandId: 'command:early-resume',
			kind: 'resume-routine',
			actionId: 'read:document'
		} ) ).toThrowError( expect.objectContaining( { code: 'E_ANIMATION_STATE' } ) );

	} );

	it( 'throws the public error type', () => {

		const error = new AnimationCoordinationError( 'E_ANIMATION_ACTION', 'missing' );
		expect( error ).toBeInstanceOf( Error );
		expect( error.code ).toBe( 'E_ANIMATION_ACTION' );

	} );

} );
