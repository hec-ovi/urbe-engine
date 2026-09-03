import { describe, expect, it } from 'vitest';
import interior from './fixtures/interior-incident.json';
import { InvestigationError } from './InvestigationError.js';
import { InvestigationRuntime } from './InvestigationRuntime.js';
import { SceneAssembler } from './SceneAssembler.js';

const assembly = new SceneAssembler().assemble( interior );

describe( 'InvestigationRuntime', () => {

	it( 'unlocks authored evidence in prerequisite order and persists each result', () => {

		const runtime = new InvestigationRuntime( assembly );
		const initial = structuredClone( assembly.initialState );

		expect( availability( runtime, initial ) ).toEqual( {
			'body-position': true,
			'blood-direction': false,
			'access-card': false
		} );

		const blocked = runtime.perform( request( 'access-card', 'inspect', initial ) );
		expect( blocked ).toMatchObject( { ok: false, code: 'prerequisite', events: [], worldChanges: [] } );
		expect( blocked.state ).toEqual( initial );

		const body = runtime.perform( request( 'body-position', 'inspect', initial ) );
		expect( body ).toMatchObject( {
			ok: true,
			events: [ { transitionId: 'unlock-blood-reading', kind: 'objective-unlock', key: 'inspect-blood-direction', value: true } ]
		} );
		expect( initial ).toEqual( assembly.initialState );
		expect( availability( runtime, body.state )[ 'blood-direction' ] ).toBe( true );

		const restored = JSON.parse( JSON.stringify( body.state ) );
		const blood = new InvestigationRuntime( assembly ).perform( request( 'blood-direction', 'inspect', restored ) );
		expect( blood.events ).toEqual( [ {
			transitionId: 'unlock-card-reading', kind: 'dialogue-unlock', key: 'ask-about-access-card', value: true
		} ] );
		expect( availability( runtime, blood.state )[ 'access-card' ] ).toBe( true );

	} );

	it( 'requires inspection before collecting portable evidence and removes its exact visual once', () => {

		const runtime = new InvestigationRuntime( assembly );
		let state = progressToCard( runtime );

		const early = runtime.perform( request( 'access-card', 'take', state ) );
		expect( early ).toMatchObject( { ok: false, code: 'inspect-first', events: [], worldChanges: [] } );

		const inspected = runtime.perform( request( 'access-card', 'inspect', state ) );
		expect( inspected.events ).toEqual( [ {
			transitionId: 'record-card-owner', kind: 'quest-signal', key: 'access-card-owner-known', value: true
		} ] );

		const collected = runtime.perform( request( 'access-card', 'take', inspected.state ) );
		expect( collected ).toMatchObject( {
			ok: true,
			worldChanges: [ { entityId: 'dropped-access-card', state: 'collected' } ],
			events: [ {
				transitionId: 'branch-restricted-level', kind: 'ending-candidate', key: 'follow-restricted-level-lead', value: true
			} ]
		} );
		expect( collected.state.evidence.find( ( item ) => item.evidenceId === 'access-card' ).status ).toBe( 'collected' );

		const repeated = runtime.perform( request( 'access-card', 'take', collected.state ) );
		expect( repeated ).toMatchObject( { ok: false, code: 'already-resolved', events: [], worldChanges: [] } );
		expect( repeated.state ).toEqual( collected.state );

	} );

	it( 'does not advance through a wall, outside visibility or beyond measured reach', () => {

		const runtime = new InvestigationRuntime( assembly );
		const state = assembly.initialState;

		expect( runtime.perform( request( 'body-position', 'inspect', state, { visible: false } ) ).code ).toBe( 'not-visible' );
		expect( runtime.perform( request( 'body-position', 'inspect', state, { unobstructed: false } ) ).code ).toBe( 'occluded' );
		expect( runtime.perform( request( 'body-position', 'inspect', state, { distanceMeters: 2.251 } ) ).code ).toBe( 'out-of-reach' );
		expect( state ).toEqual( assembly.initialState );

	} );

	it( 'rejects semantically corrupted save state instead of awarding evidence again', () => {

		const runtime = new InvestigationRuntime( assembly );
		const duplicate = structuredClone( assembly.initialState );
		duplicate.evidence.push( structuredClone( duplicate.evidence[ 0 ] ) );

		expect( () => runtime.targets( { state: duplicate } ) ).toThrowError( expect.objectContaining( {
			code: 'E_INVESTIGATION_STATE'
		} ) );

		const foreignTransition = structuredClone( assembly.initialState );
		foreignTransition.emittedTransitionIds.push( 'fabricated-event' );
		expect( () => runtime.targets( { state: foreignTransition } ) ).toThrow( InvestigationError );

	} );

} );

function progressToCard( runtime ) {

	const body = runtime.perform( request( 'body-position', 'inspect', assembly.initialState ) );
	return runtime.perform( request( 'blood-direction', 'inspect', body.state ) ).state;

}

function availability( runtime, state ) {

	return Object.fromEntries( runtime.targets( { state } ).map( ( target ) => [ target.evidenceId, target.available ] ) );

}

function request( evidenceId, action, state, focus = {} ) {

	return {
		targetKey: `investigation:${encodeURIComponent( assembly.sceneId )}:${encodeURIComponent( evidenceId )}`,
		action,
		state,
		focus: { visible: true, unobstructed: true, distanceMeters: 1, ...focus }
	};

}
