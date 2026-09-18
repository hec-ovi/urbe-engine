import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { Crowd, crowdClipForName } from './Crowd.js';
import { CLIP } from './CharacterAssets.js';
import { WalkRoutes } from './WalkRoutes.js';
import { SIDEWALK_HEIGHT } from '../ground/GroundBuilder.js';

/**
 * Walking people are not dynamic physics bodies, so the crowd's own pushback
 * stands between the player and walking through a pedestrian. It has to
 * clear the whole overlap, point away from the person, and reach nobody it is
 * not actually touching.
 */
describe( 'Crowd pushback', () => {

	const CLEARANCE = 0.32;
	// PERSON_RADIUS + the player's own radius: closer than this is standing
	// inside somebody.
	const REACH = 0.34 + CLEARANCE;

	it( 'clears the whole overlap, away from the person, and reaches nobody else', () => {

		const crowd = crowdWith( [ [ 0.3, 0, 0 ], [ REACH + 0.01, 0, 0 ], [ 0.1, 4, 0 ] ] );
		const push = crowd.pushback( new THREE.Vector3( 0, 0, 0 ), CLEARANCE );

		expect( push.x ).toBeCloseTo( - ( REACH - 0.3 ) );
		expect( push.z ).toBeCloseTo( 0 );

		// after the push the player is exactly out of them, not still inside
		expect( Math.hypot( push.x - 0.3, push.z ) ).toBeCloseTo( REACH );

	} );

} );

describe( 'Crowd route elevation', () => {

	it( 'joins the raised stair mouth to authored switchback and lower landing heights', () => {

		const routes = new WalkRoutes( { walk: {
			nodes: [
				{ id: 'top', x: 0, y: 0, z: 0, kind: 'station-access' },
				{ id: 'bottom', x: 0, y: - 10, z: 0, kind: 'station-handoff' }
			],
			edges: [ {
				id: 'stairs', from: 'top', to: 'bottom', kind: 'stairs', width: 1.2, level: 0,
				path: [ [ 0, 0 ], [ 5, 0 ], [ 0, 0 ] ], path3: [ [ 0, 0, 0 ], [ 5, - 5, 0 ], [ 0, - 10, 0 ] ]
			} ]
		} } );
		const agents = [
			{ crowdId: 'mouth', progress: 0, direction: 1 },
			{ crowdId: 'switchback', progress: 0.5, direction: 1 },
			{ crowdId: 'lower-landing', progress: 0, direction: - 1 }
		].map( agent => ( {
			...agent, type: 'commuter', activity: 'commuting', place: { kind: 'edge', id: 'stairs' }
		} ) );
		const crowd = new Crowd( {
			assets: { variants: [ {} ], durations: [ 1, 1, 1 ], meshesOf: () => [] },
			routes, signals: { green: () => true }, sim: { crowd: () => ( { agents } ) },
			places: new Map(), capacity: 3
		} );

		crowd.update( 0, new THREE.Vector3( 5, - 5, 0 ), { timeMin: 0, daySeconds: 0 } );

		const positions = Object.fromEntries( [ ...crowd.members.values() ]
			.map( walker => [ walker.crowdId, walker.position ] ) );
		const lowerLanding = - 10 + 0.02;
		expect( positions.mouth.toArray() ).toEqual( [ 0, SIDEWALK_HEIGHT, 0 ] );
		expect( positions.switchback.x ).toBeCloseTo( 5 );
		expect( positions.switchback.y ).toBeCloseTo( ( SIDEWALK_HEIGHT + lowerLanding ) / 2 );
		expect( positions[ 'lower-landing' ].toArray() ).toEqual( [ 0, lowerLanding, 0 ] );

	} );

} );

describe( 'Crowd population window', () => {

	it( 'renders 500 unique simulation handles on their authoritative paths beyond the ordinary window', () => {

		const edges = Array.from( { length: 500 }, ( _, index ) => {

			const x = ( index % 25 ) * 10 - 120;
			const z = Math.floor( index / 25 ) * 10 + 160;
			return {
				id: `edge:${index}`, from: `from:${index}`, to: `to:${index}`, kind: 'sidewalk',
				path3: [ [ x, 2, z ], [ x + 8, 2, z ] ]
			};

		} );
		const routes = new WalkRoutes( { walk: { nodes: [], edges } } );
		const agents = edges.map( ( edge, index ) => ( {
			crowdId: `trip:${index}`, type: 'commuter', activity: 'commuting',
			place: { kind: 'edge', id: edge.id }, progress: 0.5, direction: 1
		} ) );
		const sim = { crowd: vi.fn( () => ( { agents } ) ) };
		let rendered = 0;
		const mesh = { setInstance: () => {}, commit: count => { rendered += count; } };
		const crowd = new Crowd( {
			assets: { variants: [ {}, {} ], durations: [ 1, 1, 1 ], meshesOf: () => [ mesh ] },
			routes, signals: { green: () => true }, sim, places: new Map(), capacity: 500, spawnRadius: 500
		} );
		const player = new THREE.Vector3();
		crowd.update( 0, player, { timeMin: 1260, daySeconds: 75600 } );
		expect( sim.crowd ).toHaveBeenCalledWith( 1260, { kind: 'radius', x: 0, z: 0, metres: 500 }, { maxAgents: 500 } );
		expect( crowd.count ).toBe( 500 );
		expect( rendered ).toBe( 500 );
		expect( new Set( [ ...crowd.members.values() ].map( member => member.crowdId ) ).size ).toBe( 500 );
		expect( [ ...crowd.members.values() ].every( member => ! member.copy && member.position.y === 2 + SIDEWALK_HEIGHT ) ).toBe( true );
		const bodies = [ ...crowd.members.keys() ];
		crowd.update( 3, player, { timeMin: 1260, daySeconds: 75603 } );
		expect( [ ...crowd.members.keys() ] ).toEqual( bodies );
		sim.crowd.mockReturnValue( { agents: [] } );
		crowd.update( 3, new THREE.Vector3( 1000, 0, 0 ), { timeMin: 1260, daySeconds: 75606 } );
		expect( crowd.count ).toBe( 0 );

	} );

} );

describe( 'persistent NPC projection', () => {

	it( 'updates, unloads and recreates one npcId with the same authored body and animation state', () => {

		const routes = pavement();
		const instance = {
			npcId: 'named-worker', name: { given: 'Mina', family: 'Costa' },
			type: 'barista', gender: 'female', appearanceSeed: 91234
		};
		const crowd = new Crowd( {
			assets: testAssets(), routes, signals: { green: () => true },
			sim: { getNPC: () => instance, crowd: () => ( { agents: [] } ) },
			places: new Map(), capacity: 4
		} );
		const player = new THREE.Vector3();
		const actor = persistentActor( instance );
		const first = crowd.syncActor( actor, player );

		expect( first ).toMatchObject( {
			npcId: 'named-worker', appearanceSeed: 91234, continuity: true,
			clip: CLIP.WALK, controlMode: 'following'
		} );
		const body = { variant: first.variant, look: first.look };
		const updated = crowd.syncActor( { ...actor, animation: 'run', position: [ 3, 0, 0 ] }, player );
		expect( updated ).toBe( first );
		expect( updated.position.toArray() ).toEqual( [ 3, 0, 0 ] );
		expect( updated.clip ).toBe( CLIP.RUN );
		expect( crowd.count ).toBe( 1 );

		expect( crowd.syncActor( { ...actor, visible: false }, player ) ).toBeNull();
		expect( crowd.count ).toBe( 0 );
		const returned = crowd.syncActor( { ...actor, animation: 'sit', mode: 'schedule' }, player );
		expect( returned ).not.toBe( first );
		expect( returned ).toMatchObject( { npcId: 'named-worker', clip: CLIP.SIT, ...body } );

	} );

	it( 'adopts the existing anonymous parcel body before continuity projects the same cast NPC', () => {

		const instance = {
			npcId: 'cast-worker', name: { given: 'Ivo', family: 'Reis' },
			type: 'barista', gender: 'male', appearanceSeed: 44
		};
		const inside = new THREE.Vector3( 2, 0, 3 );
		const actor = {
			...persistentActor( instance ), place: { kind: 'parcel', id: 'cafe' },
			position: inside.toArray(), animation: 'idle', mode: 'schedule'
		};
		const continuity = { appear: vi.fn( () => actor ) };
		const handle = {
			crowdId: 'staff-handle', type: 'barista', gender: 'male', appearanceSeed: 44,
			activity: 'working', place: { kind: 'parcel', id: 'cafe' }
		};
		const sim = {
			crowd: ( timeMin, scope ) => ( { agents: scope.kind === 'parcel' ? [ handle ] : [] } ),
			instantiate: vi.fn( () => instance ), getNPC: () => instance
		};
		const crowd = new Crowd( {
			assets: testAssets(), routes: pavement(), signals: { green: () => true }, sim, continuity,
			places: new Map( [ [ 'cafe', { inside, heading: 0, anchors: {} } ] ] ), capacity: 4
		} );
		crowd.update( 0, inside, { timeMin: 600, daySeconds: 36000 } );
		const anonymous = [ ...crowd.members.values() ][ 0 ];
		expect( anonymous ).toMatchObject( { crowdId: 'staff-handle', npcId: null } );

		const named = crowd.questMember( instance.npcId, 600, inside, { kind: 'parcel', id: 'cafe' } );
		expect( continuity.appear ).toHaveBeenCalledWith( { npcId: instance.npcId, timeMin: 600 } );
		expect( named ).toBe( anonymous );
		expect( named ).toMatchObject( { crowdId: 'staff-handle', npcId: 'cast-worker', continuity: true } );
		expect( crowd.members.size ).toBe( 1 );

		// a body the schedule puts somewhere else is never the cast NPC's
		expect( crowd.questMember( instance.npcId, 601, inside, { kind: 'edge', id: 'e1' } ) ).toBeNull();

	} );

	it( 'keeps one impacted identity frozen and out of interaction until physics rejects it', () => {

		const instance = {
			npcId: 'impact-worker', name: { given: 'Rae', family: 'Silva' },
			type: 'barista', gender: 'female', appearanceSeed: 32
		};
		const crowd = new Crowd( {
			assets: testAssets(), routes: pavement(), signals: { green: () => true },
			sim: { getNPC: () => instance, crowd: () => ( { agents: [] } ) },
			places: new Map(), capacity: 4
		} );
		const member = crowd.syncActor( persistentActor( instance ), new THREE.Vector3() );

		expect( crowd.beginRagdoll( member.id ) ).toBe( member );
		expect( member ).toMatchObject( { fallen: true, frozen: true } );
		expect( crowd.within( member.position, 2 ) ).toEqual( [] );
		expect( crowd.pushback( member.position, 0.32 ).length() ).toBe( 0 );
		expect( crowd.syncActor( { ...persistentActor( instance ), position: [ 9, 0, 0 ] }, new THREE.Vector3() ) )
			.toBeNull();
		expect( member.position.toArray() ).toEqual( [ 0, 0, 0 ] );

		expect( crowd.cancelRagdoll( member.id ) ).toBe( member );
		expect( member ).toMatchObject( { fallen: false, frozen: true } );
		expect( crowd.within( member.position, 2 ) ).toEqual( [ member ] );

	} );

} );

describe( 'exact animation projection', () => {

	it( 'maps every coordinator clip to its closest VAT state', () => {

		const states = {
			Walk_Loop: CLIP.WALK, Walk_Formal_Loop: CLIP.WALK,
			Sprint_Enter: CLIP.RUN, Sprint_Loop: CLIP.RUN,
			Crouch_Idle_Loop: CLIP.CROUCH, Idle_Talking_Loop: CLIP.TALK,
			Sitting_Talking_Loop: CLIP.SIT_TALK, Sitting_Nodding_Loop: CLIP.SIT,
			PickUp_Ground: CLIP.IDLE
		};

		for ( const [ clipName, expected ] of Object.entries( states ) ) {

			expect( { clipName, state: crowdClipForName( clipName ) } ).toEqual( { clipName, state: expected } );

		}

	} );

} );

const PLAYER = new THREE.Vector3( 0, SIDEWALK_HEIGHT, 0 );

/** 240 m of straight pavement in 40 m edges, the player standing at its middle. */
function pavement() {

	const nodes = [];
	const edges = [];

	for ( let i = 0; i <= 6; i ++ ) nodes.push( { id: `n${i}`, x: - 120 + i * 40, y: 0, z: 0, kind: 'sidewalk' } );

	for ( let i = 0; i < 6; i ++ ) {

		edges.push( {
			id: `e${i}`, from: `n${i}`, to: `n${i + 1}`, kind: 'sidewalk',
			path: [ [ nodes[ i ].x, 0 ], [ nodes[ i + 1 ].x, 0 ] ],
			path3: [ [ nodes[ i ].x, 0, 0 ], [ nodes[ i + 1 ].x, 0, 0 ] ]
		} );

	}

	return new WalkRoutes( { walk: { nodes, edges } } );

}

function testAssets() {

	return { variants: Array.from( { length: 8 }, () => ( {} ) ), durations: Array( 8 ).fill( 1 ), meshesOf: () => [] };

}

function persistentActor( instance ) {

	return {
		npcId: instance.npcId,
		name: instance.name,
		type: instance.type,
		gender: instance.gender,
		appearanceSeed: instance.appearanceSeed,
		place: { kind: 'edge', id: 'e0' },
		position: [ 0, 0, 0 ],
		heading: 0,
		animation: 'walk',
		mode: 'following',
		schedule: { activity: 'commuting', progress: 0.5, nextDestination: { kind: 'parcel', id: 'p1' } },
		visible: true
	};

}

/**
 * A street handle names a sampled agent for one epoch of that pavement, so the
 * same people come back under new handles minute after minute. The body a
 * named person walks in is never handed to one of those later handles.
 */
describe( 'Crowd bodies', () => {

	it( 'never hands a named body to a later statistical handle', () => {

		const routes = pavement();
		let agents = [ {
			crowdId: 'first-trip', type: 'courier', gender: 'female', appearanceSeed: 123,
			activity: 'commuting', place: { kind: 'edge', id: 'e2' }, progress: 0.5, direction: 1
		} ];
		const npc = {
			npcId: 'a17', type: 'courier', gender: 'female', appearanceSeed: 123,
			name: { given: 'Mara', family: 'Vale' }, flags: { dead: false }
		};
		const sim = {
			crowd: () => ( { agents } ),
			getNPC: () => npc,
			instantiate: () => npc,
			continuityAt: () => ( { movement: { current: { edgeId: 'e2', progress: 0.5 } } } )
		};
		const crowd = new Crowd( {
			assets: { variants: [ {}, {} ], durations: [ 1 ], meshesOf: () => [] },
			routes, signals: { green: () => true }, sim, places: new Map(), capacity: 4
		} );
		const clock = { timeMin: 780, daySeconds: 46800 };
		crowd.update( 0, PLAYER, clock );
		const named = crowd.questMember( npc.npcId, clock.timeMin, PLAYER, { kind: 'edge', id: 'e2' } );
		expect( named ).toMatchObject( { npcId: 'a17', crowdId: 'first-trip', appearanceSeed: 123 } );

		agents = [];
		crowd.update( 3, PLAYER, clock );
		expect( named ).toMatchObject( { npcId: 'a17', crowdId: null, retiring: true } );
		agents = [ {
			crowdId: 'later-trip', type: 'courier', gender: 'female', appearanceSeed: 456,
			activity: 'commuting', place: { kind: 'edge', id: 'e2' }, progress: 0.5, direction: 1
		} ];
		crowd.update( 3, PLAYER, clock );
		expect( named.npcId ).toBe( 'a17' );
		expect( [ ...crowd.members.values() ].find( ( member ) => member.crowdId === 'later-trip' ) ).not.toBe( named );

	} );

} );

/** A crowd with nobody walking: only the members the pushback reads. */
function crowdWith( positions ) {

	const crowd = new Crowd( {
		assets: null, routes: null, signals: null, sim: null,
		places: new Map(), capacity: positions.length
	} );

	positions.forEach( ( [ x, y, z ], i ) => {

		crowd.members.set( `c${i}`, { position: new THREE.Vector3( x, y, z ) } );

	} );

	return crowd;

}

describe( 'Crowd inside a building', () => {

	it( 'stands staff at the work spots, sits guests on the seats, keeps the overflow in the lobby', () => {

		const seat = { id: 'f0-a1', position: new THREE.Vector3( 12, 0, 11 ), heading: 1 };
		const work = { id: 'f0-a2', position: new THREE.Vector3( 9, 0, 13 ), heading: 2 };
		const inside = new THREE.Vector3( 10, 0, 10 );
		const guest = ( id ) => ( { crowdId: id, type: 'patron', gender: 'female', activity: 'leisure', place: { kind: 'parcel', id: 'p1' } } );
		const sim = { crowd: ( timeMin, scope ) => ( { agents: scope.kind !== 'parcel' ? [] : [
			{ ...guest( 'w1' ), activity: 'working' }, guest( 'g1' ), guest( 'g2' )
		] } ) };
		const crowd = new Crowd( {
			assets: { variants: [ {}, {} ], durations: [ 1, 1, 1, 1, 1 ], meshesOf: () => [] },
			routes: pavement(), signals: { green: () => true }, sim,
			places: new Map( [ [ 'p1', { inside, heading: 0, anchors: { seat: [ seat ], work: [ work ] } } ] ] ),
			capacity: 200
		} );

		crowd.update( 0.1, PLAYER, { timeMin: 780, daySeconds: 46800, seconds: 46800 } );

		const byId = new Map( [ ...crowd.members.values() ].map( ( m ) => [ m.crowdId, m ] ) );
		expect( byId.get( 'w1' ) ).toMatchObject( { clip: CLIP.IDLE, spot: 'work:0', heading: 2 } );
		expect( byId.get( 'w1' ).position.equals( work.position ) ).toBe( true );
		expect( byId.get( 'g1' ) ).toMatchObject( { clip: CLIP.SIT, spot: 'seat:0', heading: 1 } );
		expect( byId.get( 'g1' ).position.equals( seat.position ) ).toBe( true );
		expect( byId.get( 'g2' ) ).toMatchObject( { clip: CLIP.IDLE, spot: 'lobby:0' } );
		expect( byId.get( 'g2' ).position.distanceTo( inside ) ).toBeLessThan( 3 );

	} );

} );
