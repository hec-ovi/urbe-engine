import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { QuestGameplay, questGameplayWorld } from './QuestGameplay.js';
import { QuestActionError } from './QuestActionError.js';

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

function setup( actions, { crowd = { questMember: () => null }, blocked = false } = {} ) {

	class Ray {

		constructor( origin, dir ) { this.origin = origin; this.dir = dir; }

	}

	return new QuestGameplay( {
		actions,
		world: { parcels: [ { id: 'p9', anchor: [ 0, 0, - 2 ] } ] },
		crowd,
		physics: { rapier: { Ray }, world: { castRay: () => blocked ? { toi: 0.5 } : null } },
		playerCollider: {},
		materialFactory: { build: () => new THREE.MeshStandardMaterial( { color: 0x223344 } ) }
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
		presentation: { name: `target ${kind}`, description: `${kind} target`, icon: kind, highlight: 'area-marker', actions },
		availability: { available: true }
	};

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
