import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { Crowd, crowdClipForName } from './Crowd.js';
import { CLIP } from './CharacterAssets.js';
import { StreetBodies } from './StreetBodies.js';
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
		// Each of them keeps to their own side of the stair, inside its width.
		const side = 1.2 / 2;
		expect( positions.mouth.y ).toBe( SIDEWALK_HEIGHT );
		expect( Math.hypot( positions.mouth.x, positions.mouth.z ) ).toBeLessThan( side );
		expect( positions.switchback.x ).toBeCloseTo( 5, 1 );
		expect( positions.switchback.y ).toBeCloseTo( ( SIDEWALK_HEIGHT + lowerLanding ) / 2 );
		expect( positions[ 'lower-landing' ].y ).toBeCloseTo( lowerLanding );
		expect( Math.hypot( positions[ 'lower-landing' ].x, positions[ 'lower-landing' ].z ) ).toBeLessThan( side );

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

	it.each( [ [ 'seat', 'leisure', 'sit' ], [ 'work', 'working', 'idle' ] ] )(
		'reserves a restored %s post so another sampled person cannot occupy it', ( kind, activity, animation ) => {

			const instance = {
				npcId: 'posted-person', name: { given: 'Mina', family: 'Costa' },
				type: 'barista', gender: 'female', appearanceSeed: 91234
			};
			const inside = new THREE.Vector3( 2, 0, 3 );
			const anchors = [
				{ position: new THREE.Vector3( 4, 0, 3 ), heading: 0.5 },
				{ position: new THREE.Vector3( 6, 0, 3 ), heading: 0.5 }
			];
			const sample = { npcId: instance.npcId, crowdId: 'posted-handle', type: instance.type,
				gender: instance.gender, appearanceSeed: instance.appearanceSeed, activity,
				place: { kind: 'parcel', id: 'cafe' } };
			let agents = [ sample ];
			const crowd = new Crowd( {
				assets: testAssets(), routes: pavement(), signals: { green: () => true },
				sim: { getNPC: () => instance, crowd: ( timeMin, scope ) => ( { agents: scope.kind === 'parcel' ? agents : [] } ) },
				places: new Map( [ [ 'cafe', { inside, heading: 0, anchors: { [ kind ]: anchors } } ] ] ), capacity: 4
			} );
			crowd.update( 0, inside, { timeMin: 600, daySeconds: 36000 } );
			const original = crowd.memberForNpc( instance.npcId );
			const actor = { ...persistentActor( instance ), place: sample.place,
				position: original.position.toArray(), heading: original.heading, animation, mode: 'schedule' };
			// Promotion without a saved post still preserves the existing reservation.
			expect( crowd.syncActor( actor, inside ).spot ).toBe( `${kind}:0` );
			const saved = { ...actor, spot: original.spot };
			crowd.syncActor( { ...saved, visible: false }, new THREE.Vector3( 1000, 0, 1000 ) );
			expect( crowd.count ).toBe( 0 );
			const restored = crowd.syncActor( saved, inside );
			expect( restored ).not.toBe( original );
			expect( restored.spot ).toBe( `${kind}:0` );

			agents = [ sample, { ...sample, npcId: undefined, crowdId: 'new-person', appearanceSeed: 42 } ];
			crowd.update( 3, inside, { timeMin: 601, daySeconds: 36060 } );
			const newcomer = [ ...crowd.members.values() ].find( member => member.crowdId === 'new-person' );
			expect( crowd.count ).toBe( 2 );
			expect( [ ...crowd.members.values() ].filter( member => member.npcId === instance.npcId ) ).toEqual( [ restored ] );
			expect( restored.position.toArray() ).toEqual( anchors[ 0 ].position.toArray() );
			expect( newcomer.spot ).toBe( `${kind}:1` );
			expect( newcomer.position.toArray() ).toEqual( anchors[ 1 ].position.toArray() );

		}
	);

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

		// The statistical post still reports this handle while continuity owns it.
		// Twenty resamples and repeated quest materialization must consume that
		// same body, including while a focused rig hides its VAT instance.
		named.hero = true;
		const position = named.position.clone();
		for ( let second = 3; second <= 60; second += 3 ) {

			crowd.update( 3, inside, { timeMin: 600 + second / 60, daySeconds: 36000 + second } );
			expect( crowd.questMember( instance.npcId, 600 + second / 60, inside, actor.place ) ).toBe( named );
			expect( crowd.count ).toBe( 1 );
			expect( named.position.equals( position ) ).toBe( true );

		}
		expect( sim.instantiate ).toHaveBeenCalledTimes( 1 );

		// a body the schedule puts somewhere else is never the cast NPC's
		expect( crowd.questMember( instance.npcId, 601, inside, { kind: 'edge', id: 'e1' } ) ).toBeNull();

	} );

	it( 'consumes established samples even when a quest body was posted before its handle was loaded', () => {

		const instance = {
			npcId: 'reserved-worker', name: { given: 'Petra', family: 'Costa' },
			type: 'barista', gender: 'female', appearanceSeed: 44
		};
		const inside = new THREE.Vector3( 2, 0, 3 );
		const actor = { ...persistentActor( instance ), place: { kind: 'parcel', id: 'cafe' },
			position: inside.toArray(), animation: 'sit', mode: 'conversation' };
		const handle = { npcId: instance.npcId, crowdId: 'late-staff-handle', type: 'barista',
			gender: 'female', appearanceSeed: 44, activity: 'working', place: actor.place };
		const sim = {
			crowd: ( timeMin, scope ) => ( { agents: scope.kind === 'parcel' ? [ handle ] : [] } ),
			instantiate: vi.fn( () => instance ), getNPC: () => instance
		};
		const crowd = new Crowd( { assets: testAssets(), routes: pavement(), signals: { green: () => true }, sim,
			places: new Map( [ [ 'cafe', { inside, heading: 0, anchors: {} } ] ] ), capacity: 4 } );
		const member = crowd.syncActor( actor, inside );
		member.hero = true;
		for ( let second = 0; second <= 60; second += 3 ) {

			crowd.update( 3, inside, { timeMin: 1260 + second / 60, daySeconds: 75600 + second } );
			expect( [ ...crowd.members.values() ] ).toEqual( [ member ] );
			expect( member.position.toArray() ).toEqual( actor.position );
			expect( member.clip ).toBe( CLIP.SIT );

		}
		expect( sim.instantiate ).not.toHaveBeenCalled();
		// Unload/reload creates one replacement whose identity already belongs
		// to the sampled worker; projecting continuity adopts that exact body.
		member.hero = false;
		crowd.syncActor( { ...actor, visible: false }, inside );
		crowd.update( 3, inside, { timeMin: 1261, daySeconds: 75660 } );
		const replacement = crowd.memberForNpc( instance.npcId );
		expect( replacement ).not.toBe( member );
		expect( crowd.syncActor( actor, inside ) ).toBe( replacement );
		expect( crowd.count ).toBe( 1 );

	} );

	it( 'keeps stress-test copies anonymous when the street sample has an established identity', () => {

		const instance = { npcId: 'walker', type: 'courier', gender: 'female', appearanceSeed: 44 };
		const agent = { npcId: instance.npcId, crowdId: 'walk-handle', type: 'courier', gender: 'female',
			appearanceSeed: 44, activity: 'commuting', place: { kind: 'edge', id: 'e2' }, progress: 0.5, direction: 1 };
		const crowd = new Crowd( { assets: testAssets(), routes: pavement(), signals: { green: () => true },
			sim: { getNPC: () => instance, crowd: () => ( { agents: [ agent ] } ) },
			places: new Map(), capacity: 6, stress: 2 } );
		crowd.update( 0, new THREE.Vector3(), { timeMin: 1260, daySeconds: 75600 } );
		const copies = [ ...crowd.members.values() ].filter( member => member.copy );
		expect( copies ).toHaveLength( 2 );
		expect( copies.every( member => member.npcId === null && member.instance === null && member.crowdId === null ) ).toBe( true );
		expect( [ ...crowd.members.values() ].filter( member => member.npcId === instance.npcId ) ).toHaveLength( 1 );

	} );

	it( 'removes an anonymous existing post when its next sample identifies the separately posted cast body', () => {

		const instance = { npcId: 'reserved', type: 'barista', gender: 'female', appearanceSeed: 44 };
		const inside = new THREE.Vector3();
		let agent = { crowdId: 'alias', type: 'barista', gender: 'female', appearanceSeed: 44,
			activity: 'working', place: { kind: 'parcel', id: 'cafe' } };
		const crowd = new Crowd( { assets: testAssets(), routes: pavement(), signals: { green: () => true },
			sim: { getNPC: () => instance, crowd: ( timeMin, scope ) => ( { agents: scope.kind === 'parcel' ? [ agent ] : [] } ) },
			places: new Map( [ [ 'cafe', { inside, heading: 0, anchors: {} } ] ] ), capacity: 4 } );
		crowd.update( 0, inside, { timeMin: 1260, daySeconds: 75600 } );
		const alias = [ ...crowd.members.values() ][ 0 ];
		const canonical = crowd.syncActor( { ...persistentActor( instance ), place: agent.place }, inside );
		canonical.hero = true;
		expect( crowd.count ).toBe( 2 );
		agent = { ...agent, npcId: instance.npcId };
		crowd.update( 3, inside, { timeMin: 1260, daySeconds: 75603 } );
		expect( [ ...crowd.members.values() ] ).toEqual( [ canonical ] );
		expect( crowd.members.has( alias.id ) ).toBe( false );

	} );

	it( 'merges a discovered alias into the existing focused identity', () => {

		const instance = { npcId: 'reserved', type: 'barista', gender: 'female', appearanceSeed: 44 };
		const inside = new THREE.Vector3();
		const agent = { crowdId: 'alias', type: 'barista', gender: 'female', appearanceSeed: 44,
			activity: 'working', place: { kind: 'parcel', id: 'cafe' } };
		const crowd = new Crowd( { assets: testAssets(), routes: pavement(), signals: { green: () => true },
			sim: { getNPC: () => instance, crowd: ( timeMin, scope ) => ( { agents: scope.kind === 'parcel' ? [ agent ] : [] } ) },
			places: new Map( [ [ 'cafe', { inside, heading: 0, anchors: {} } ] ] ), capacity: 4 } );
		const canonical = crowd.syncActor( { ...persistentActor( instance ), place: agent.place }, inside );
		canonical.hero = true;
		crowd.update( 0, inside, { timeMin: 1260, daySeconds: 75600 } );
		const alias = [ ...crowd.members.values() ].find( member => ! member.npcId );
		expect( alias ).toBeDefined();
		expect( crowd.identify( alias, instance ) ).toBe( canonical );
		expect( [ ...crowd.members.values() ] ).toEqual( [ canonical ] );

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

/**
 * A crowd slice is counts and candidates: the simulation reports a group on
 * one walk edge at one progress, so five people come back on one spot, at one
 * speed, on one footfall. Placed as reported that is one body with four
 * shadows, and it is what the street actually looked like.
 */
describe( 'Crowd cast at a quest parcel', () => {

	it( 'stands the story\'s person at the counter, else a work spot, else inside the door, and never twice', () => {

		const instance = { npcId: 'npc-denna', name: { given: 'River', family: 'Nakamura' }, type: 'receptionist', gender: 'female', appearanceSeed: 7 };
		const sim = { getNPC: () => instance, crowd: () => ( { agents: [] } ), instantiate: () => null };
		const inside = new THREE.Vector3( 10, 0, 10 );
		const counter = { id: 'f0-a6', position: new THREE.Vector3( 14, 0, 12 ), heading: 1 };
		const work = { id: 'f0-a2', position: new THREE.Vector3( 9, 0, 13 ), heading: 2 };
		const crowdIn = ( anchors ) => new Crowd( {
			assets: testAssets(), routes: pavement(), signals: { green: () => true }, sim,
			places: new Map( [ [ 'p17', { inside, heading: 0, anchors } ] ] ), capacity: 4
		} );

		const served = crowdIn( { counter: [ counter ], work: [ work ] } );
		const cast = served.castMember( 'npc-denna', 1264, inside, 'p17' );
		expect( cast ).toMatchObject( { npcId: 'npc-denna', quest: true, parcelId: 'p17', spot: 'counter:0', clip: CLIP.IDLE, heading: 1 } );
		expect( cast.position.equals( counter.position ) ).toBe( true );
		expect( served.castMember( 'npc-denna', 1265, inside, 'p17' ) ).toBe( cast );
		expect( served.members.size ).toBe( 1 );

		expect( crowdIn( { work: [ work ] } ).castMember( 'npc-denna', 1264, inside, 'p17' ).position.equals( work.position ) ).toBe( true );
		const lobby = crowdIn( {} ).castMember( 'npc-denna', 1264, inside, 'p17' );
		expect( lobby.spot ).toBe( 'lobby:0' );
		expect( lobby.position.distanceTo( inside ) ).toBeLessThan( 3 );
		expect( crowdIn( {} ).castMember( 'npc-denna', 1264, new THREE.Vector3( 200, 0, 0 ), 'p17' ) ).toBeNull();

	} );

	it( 'posts a cast body that has walked off back at the parcel, through continuity', () => {

		const instance = { npcId: 'npc-denna', name: { given: 'River', family: 'Nakamura' }, type: 'receptionist', gender: 'female', appearanceSeed: 7 };
		const inside = new THREE.Vector3( 10, 0, 10 );
		const counter = { id: 'f0-a6', position: new THREE.Vector3( 14, 0, 12 ), heading: 1 };
		const sim = { getNPC: () => instance, crowd: () => ( { agents: [] } ), instantiate: () => null };
		const hold = vi.fn( ( request ) => ( {
			...persistentActor( instance ), place: { ...request.place }, position: [ ...request.position ],
			heading: request.heading, animation: 'idle', mode: 'posing', visible: true
		} ) );
		const crowd = new Crowd( {
			assets: testAssets(), routes: pavement(), signals: { green: () => true }, sim,
			continuity: { hold },
			places: new Map( [ [ 'p17', { inside, heading: 0, anchors: { counter: [ counter ] } } ] ] ), capacity: 4
		} );

		const cast = crowd.castMember( 'npc-denna', 1264, inside, 'p17' );
		expect( hold ).toHaveBeenCalledWith( {
			npcId: 'npc-denna', timeMin: 1264, place: { kind: 'parcel', id: 'p17' },
			position: counter.position.toArray(), heading: 1
		} );
		expect( cast ).toMatchObject( { npcId: 'npc-denna', parcelId: 'p17', continuity: true } );
		expect( cast.position.equals( counter.position ) ).toBe( true );
		// Standing where it belongs, the same body comes back untouched.
		expect( crowd.castMember( 'npc-denna', 1265, inside, 'p17' ) ).toBe( cast );
		expect( hold ).toHaveBeenCalledTimes( 1 );

		// Walked off by its own routine, it is put back rather than handed over.
		cast.parcelId = null;
		cast.place = { kind: 'edge', id: 'e1' };
		expect( crowd.castMember( 'npc-denna', 1266, inside, 'p17' ) ).toBe( cast );
		expect( hold ).toHaveBeenCalledTimes( 2 );
		expect( crowd.members.size ).toBe( 1 );

	} );

	it( 'shows a posted cast from the doorway of a large floor even when its counter is beyond the street radius', () => {

		const instance = { npcId: 'cast-guard', name: { given: 'Ren', family: 'Cross' }, type: 'guard', gender: 'male', appearanceSeed: 9 };
		const inside = new THREE.Vector3( 191, 0, 129.7 );
		const counter = { id: 'counter', position: new THREE.Vector3( 233.07, 0, 109.56 ), heading: 0 };
		const hold = ( request ) => ( {
			...persistentActor( instance ), place: request.place, position: request.position,
			heading: request.heading, animation: 'idle', mode: 'posing', visible: true
		} );
		const crowd = new Crowd( {
			assets: testAssets(), routes: pavement(), signals: { green: () => true },
			sim: { getNPC: () => instance, crowd: () => ( { agents: [] } ), instantiate: () => null },
			continuity: { hold }, capacity: 4,
			places: new Map( [ [ 'p14', { inside, heading: 0, anchors: { counter: [ counter ] } } ] ] )
		} );

		expect( counter.position.distanceTo( inside ) ).toBeGreaterThan( 45 );
		expect( crowd.castMember( instance.npcId, 600, inside, 'p14' ) ).toMatchObject( {
			npcId: instance.npcId, parcelId: 'p14', position: counter.position
		} );

	} );

	it.each( [ false, true ] )( 'names only the matching handle and retains the appointment (continuity %s)', ( controlled ) => {

		const instance = { npcId: 'npc-denna', name: { given: 'River', family: 'Nakamura' }, type: 'receptionist', gender: 'female', appearanceSeed: 7 };
		const inside = new THREE.Vector3( 10, 0, 10 );
		const bystander = { npcId: 'npc-passer', name: { given: 'Wen', family: 'Ito' }, type: 'receptionist', gender: 'male', appearanceSeed: 12 };
		const handle = ( crowdId ) => ( {
			crowdId, type: 'receptionist', gender: 'female', activity: 'working', place: { kind: 'parcel', id: 'p17' }
		} );
		const sim = {
			getNPC: () => instance,
			crowd: ( timeMin, scope ) => ( { agents: scope.kind === 'parcel' ? [ handle( 'h1' ), handle( 'h2' ) ] : [] } ),
			instantiate: ( crowdId ) => crowdId === 'h2' ? instance : bystander
		};
		const hold = vi.fn( ( request ) => ( {
			...persistentActor( instance ), place: { ...request.place }, position: [ ...request.position ],
			heading: request.heading, animation: 'idle', mode: 'posing', visible: true
		} ) );
		const crowd = new Crowd( {
			assets: testAssets(), routes: pavement(), signals: { green: () => true }, sim,
			places: new Map( [ [ 'p17', { inside, heading: 0, anchors: {} } ] ] ), capacity: 4,
			continuity: controlled ? { hold } : null
		} );
		crowd.update( 0, inside, { timeMin: 1264, daySeconds: 36000 } );

		const cast = crowd.castMember( 'npc-denna', 1264, inside, 'p17' );
		expect( cast.npcId ).toBe( 'npc-denna' );
		expect( [ ...crowd.members.values() ].filter( ( member ) => member.npcId ) ).toEqual( [ cast ] );
		expect( cast ).toMatchObject( { quest: true, frozen: true } );
		if ( controlled ) expect( hold ).toHaveBeenCalledWith( expect.objectContaining( {
			npcId: 'npc-denna', place: { kind: 'parcel', id: 'p17' }, position: cast.position.toArray()
		} ) );
		expect( crowd.members.size ).toBe( 2 );

	} );

} );

describe( 'Crowd on a lane', () => {

	const clock = { timeMin: 510, daySeconds: 30600 };

	it( 'spreads one reported group along its pavement and onto the next segment', () => {

		const crowd = crowdOn( corner(), group( 9 ) );

		crowd.update( 0.001, PLAYER, clock );
		const walkers = [ ...crowd.members.values() ];
		const reported = walkers.filter( ( walker ) => walker.edge.id === 'short' );

		expect( walkers.length ).toBe( 9 );
		// strung out along the pavement they were reported on, at arm's length
		for ( const walker of reported ) {

			for ( const other of reported ) {

				if ( other !== walker ) expect( Math.abs( other.distance - walker.distance ) ).toBeGreaterThan( 1.19 );

			}

		}

		// six metres holds six of them; the rest carry on to the next segment
		expect( walkers.length - reported.length ).toBeGreaterThan( 0 );

		// and nowhere in the world are any two of them standing in one spot
		for ( const walker of walkers ) {

			for ( const other of walkers ) {

				if ( other !== walker ) expect( gap( walker, other ) ).toBeGreaterThanOrEqual( 0.6 );

			}

		}

	} );

	it( 'gives every one of them their own pace and their own footfall', () => {

		const crowd = crowdOn( corner(), group( 9 ) );

		crowd.update( 0.001, PLAYER, clock );
		const walkers = [ ...crowd.members.values() ];

		expect( walkers.every( ( walker ) => walker.speed >= 0.9 && walker.speed <= 1.3 ) ).toBe( true );
		expect( new Set( walkers.map( ( walker ) => walker.speed ) ).size ).toBe( 9 );
		expect( new Set( walkers.map( ( walker ) => walker.frame ) ).size ).toBe( 9 );

	} );

	it( 'keeps them out of each other while they walk and around the corner', () => {

		const crowd = crowdOn( corner(), group( 9 ) );
		let closest = Infinity;

		for ( let step = 0; step < 900; step ++ ) {

			crowd.update( 1 / 60, PLAYER, clock );
			const walkers = [ ...crowd.members.values() ];

			for ( let i = 0; i < walkers.length; i ++ ) {

				for ( let j = i + 1; j < walkers.length; j ++ ) closest = Math.min( closest, gap( walkers[ i ], walkers[ j ] ) );

			}

		}

		// 15 s of walking, every one of them over the same corner node
		expect( closest ).toBeGreaterThan( 0.3 );

	} );

	it( 'stands a settled body back up, and takes out one the simulation has buried', () => {

		const street = new StreetBodies();
		const buried = { npcId: 'run-over', type: 'courier', gender: 'female', appearanceSeed: 5, flags: { dead: true } };
		const crowd = crowdOn( corner(), group( 2 ), { street, sim: { getNPC: () => buried } } );

		crowd.update( 0.001, PLAYER, clock );
		const [ up, gone ] = [ ...crowd.members.values() ];

		// the rig takes one, slides them down the road and reports them at rest
		expect( crowd.beginRagdoll( up.id ) ).toBe( up );
		street.take( up.id );
		up.position.set( 14, 0, 0 );
		street.rest( up.id );
		crowd.update( 1 / 60, PLAYER, clock );

		expect( up ).toMatchObject( { fallen: false, frozen: false, clip: CLIP.WALK } );
		expect( crowd.members.get( up.id ) ).toBe( up );
		expect( up.position.distanceTo( new THREE.Vector3( 14, SIDEWALK_HEIGHT, 0 ) ) ).toBeLessThan( 1 );

		// and one nobody is left to stand up: out of the world, back to the count
		crowd.identify( gone, buried );
		crowd.beginRagdoll( gone.id );
		for ( let step = 0; step < 400; step ++ ) crowd.update( 1 / 60, PLAYER, clock );

		expect( crowd.members.has( gone.id ) ).toBe( false );
		expect( street.has( gone.id ) ).toBe( false );

	} );

} );

/** The distance between two people on the ground. */
function gap( walker, other ) {

	return Math.hypot( walker.position.x - other.position.x, walker.position.z - other.position.z );

}

/** One pavement joined to the next, the short one too short for a crowd. */
function corner() {

	return new WalkRoutes( { walk: {
		nodes: [ 0, 6, 46 ].map( ( x, index ) => ( { id: `c${index}`, x, y: 0, z: 0, kind: 'sidewalk' } ) ),
		edges: [
			{ id: 'short', from: 'c0', to: 'c1', kind: 'sidewalk', width: 2, path3: [ [ 0, 0, 0 ], [ 6, 0, 0 ] ] },
			{ id: 'long', from: 'c1', to: 'c2', kind: 'sidewalk', width: 2, path3: [ [ 6, 0, 0 ], [ 46, 0, 0 ] ] }
		]
	} } );

}

/** One group as the simulation reports it: one edge, one spot, one moment. */
function group( count ) {

	return Array.from( { length: count }, ( _, index ) => ( {
		crowdId: `trip:${index}`, type: 'commuter', gender: index % 2 ? 'male' : 'female',
		appearanceSeed: 1000 + index * 7, activity: 'commuting',
		place: { kind: 'edge', id: 'short' }, progress: 0.5, direction: 1
	} ) );

}

function crowdOn( routes, agents, options = {} ) {

	return new Crowd( {
		assets: testAssets(), routes, signals: { green: () => true },
		sim: { crowd: () => ( { agents } ), ...options.sim },
		places: new Map(), capacity: agents.length, street: options.street ?? new StreetBodies()
	} );

}
