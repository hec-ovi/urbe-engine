import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { Crowd, crowdClipForName } from './Crowd.js';
import { CLIP } from './CharacterAssets.js';
import { WalkRoutes } from './WalkRoutes.js';

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

	it( 'clears the whole overlap, away from the person', () => {

		const crowd = crowdWith( [ [ 0.3, 0, 0 ] ] );
		const push = crowd.pushback( new THREE.Vector3( 0, 0, 0 ), CLEARANCE );

		expect( push.x ).toBeCloseTo( - ( REACH - 0.3 ) );
		expect( push.z ).toBeCloseTo( 0 );

		// after the push the player is exactly out of them, not still inside
		expect( Math.hypot( push.x - 0.3, push.z ) ).toBeCloseTo( REACH );

	} );

	it( 'ignores anyone out of reach or on another floor', () => {

		const crowd = crowdWith( [ [ REACH + 0.01, 0, 0 ], [ 0.1, 4, 0 ] ] );
		const push = crowd.pushback( new THREE.Vector3( 0, 0, 0 ), CLEARANCE );

		expect( push.x ).toBe( 0 );
		expect( push.z ).toBe( 0 );

	} );

	it( 'sums a knot of people into one direction out of it', () => {

		const crowd = crowdWith( [ [ 0.3, 0, 0.1 ], [ 0.25, 0, - 0.1 ] ] );
		const push = crowd.pushback( new THREE.Vector3( 0, 0, 0 ), CLEARANCE );

		expect( push.x ).toBeLessThan( 0 );
		expect( Math.abs( push.z ) ).toBeLessThan( Math.abs( push.x ) );

	} );

} );

describe( 'Crowd route elevation', () => {

	it( 'places a walker on the authored subway stair height', () => {

		const routes = new WalkRoutes( { walk: {
			nodes: [
				{ id: 'top', x: 0, y: 0, z: 0, kind: 'station-access' },
				{ id: 'bottom', x: 10, y: - 10, z: 0, kind: 'station-handoff' }
			],
			edges: [ {
				id: 'stairs', from: 'top', to: 'bottom', kind: 'stairs', width: 1.2, level: 0,
				path: [ [ 0, 0 ], [ 10, 0 ] ], path3: [ [ 0, 0, 0 ], [ 10, - 10, 0 ] ]
			} ]
		} } );
		const agent = {
			crowdId: 'station-walker', type: 'commuter', activity: 'commuting',
			place: { kind: 'edge', id: 'stairs' }, progress: 0.5, direction: 1
		};
		const crowd = new Crowd( {
			assets: { variants: [ {} ], durations: [ 1, 1, 1 ], meshesOf: () => [] },
			routes, signals: { green: () => true }, sim: { crowd: () => ( { agents: [ agent ] } ) },
			places: new Map(), capacity: 2
		} );

		crowd.update( 0, new THREE.Vector3( 5, - 5, 0 ), { timeMin: 0, daySeconds: 0 } );

		const walker = [ ...crowd.members.values() ][ 0 ];
		expect( walker.position.x ).toBeCloseTo( 5 );
		expect( walker.position.y ).toBeCloseTo( - 4.93 );

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

	it( 'asks continuity for the cast npcId and rejects a body at the wrong scheduled place', () => {

		const routes = pavement();
		const instance = {
			npcId: 'cast-worker', name: { given: 'Ivo', family: 'Reis' },
			type: 'barista', gender: 'male', appearanceSeed: 44
		};
		const actor = persistentActor( instance );
		const continuity = { appear: vi.fn( () => actor ) };
		const crowd = new Crowd( {
			assets: testAssets(), routes, signals: { green: () => true }, continuity,
			sim: { getNPC: () => instance, crowd: () => ( { agents: [] } ) },
			places: new Map(), capacity: 4
		} );
		const player = new THREE.Vector3();

		expect( crowd.questMember( instance.npcId, 600, player, { kind: 'edge', id: 'e0' } )?.npcId )
			.toBe( instance.npcId );
		expect( continuity.appear ).toHaveBeenCalledWith( { npcId: instance.npcId, timeMin: 600 } );
		expect( crowd.questMember( instance.npcId, 601, player, { kind: 'edge', id: 'e1' } ) ).toBeNull();

	} );

	it( 'keeps an exact coordinator override across continuity refreshes', () => {

		const instance = {
			npcId: 'seated-listener', name: { given: 'Sora', family: 'Lin' },
			type: 'patron', gender: 'female', appearanceSeed: 901
		};
		const crowd = new Crowd( {
			assets: testAssets(), routes: pavement(), signals: { green: () => true },
			sim: { getNPC: () => instance, crowd: () => ( { agents: [] } ) },
			places: new Map(), capacity: 4
		} );
		const actor = { ...persistentActor( instance ), animation: 'sit', mode: 'conversation' };
		const member = crowd.syncActor( actor, new THREE.Vector3() );

		expect( crowd.setAnimationClip( instance.npcId, 'Sitting_Nodding_Loop' ) ).toBe( member );
		expect( member.clip ).toBe( CLIP.SIT );
		expect( crowd.syncActor( { ...actor, heading: 1 }, new THREE.Vector3() ) ).toBe( member );
		expect( crowd.memberForNpc( instance.npcId ) ).toMatchObject( {
			animationOverride: 'Sitting_Nodding_Loop', clip: CLIP.SIT, heading: 1
		} );

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
		crowd.syncActor( { ...persistentActor( instance ), position: [ 9, 0, 0 ] }, new THREE.Vector3() );
		expect( member.position.toArray() ).toEqual( [ 0, 0, 0 ] );

		expect( crowd.cancelRagdoll( member.id ) ).toBe( member );
		expect( member ).toMatchObject( { fallen: false, frozen: true } );
		expect( crowd.within( member.position, 2 ) ).toEqual( [ member ] );

	} );

} );

describe( 'exact animation projection', () => {

	it.each( [
		[ 'Walk_Loop', CLIP.WALK ], [ 'Walk_Formal_Loop', CLIP.WALK ],
		[ 'Sprint_Enter', CLIP.RUN ], [ 'Sprint_Loop', CLIP.RUN ],
		[ 'Crouch_Idle_Loop', CLIP.CROUCH ], [ 'Idle_Talking_Loop', CLIP.TALK ],
		[ 'Sitting_Talking_Loop', CLIP.SIT_TALK ], [ 'Sitting_Nodding_Loop', CLIP.SIT ],
		[ 'PickUp_Ground', CLIP.IDLE ]
	] )( 'maps %s to its closest VAT state', ( clipName, expected ) => {

		expect( crowdClipForName( clipName ) ).toBe( expected );

	} );

} );

/**
 * A street handle names a sampled agent for one epoch of that pavement, so the
 * same people come back under new handles minute after minute while the ones
 * already spawned keep walking. What the crowd has to hold over a long session
 * is the simulation's own street density, and one body per person.
 */
describe( 'Crowd over a long session', () => {

	it( 'stays at the number of people the simulation has out there', () => {

		const rows = session( 20 );

		expect( rows ).toHaveLength( 21 );

		for ( const { minute, spawned, live } of rows ) {

			expect( { minute, spawned } ).toEqual( {
				minute, spawned: Math.min( spawned, Math.round( live.length * 1.25 ) + 1 )
			} );
			expect( spawned ).toBeGreaterThanOrEqual( live.length );

		}

		// the sampled street empties and fills again through the session, so
		// the crowd is being held at the number, not just never spawning
		expect( new Set( rows.map( ( row ) => row.live.length ) ).size ).toBeGreaterThan( 1 );

	} );

	it( 'never has two people being the same one, epoch after epoch', () => {

		const rows = session( 20 );

		for ( const { minute, held, live } of rows ) {

			expect( { minute, held: held.length } ).toEqual( { minute, held: new Set( held ).size } );

			// and every one of them is somebody the simulation has out right
			// now, not a handle left over from an epoch that has passed
			expect( held.filter( ( id ) => ! live.includes( id ) ) ).toEqual( [] );

		}

	} );

} );

const EPOCH = 2;
const TYPES = [ 'shop_clerk', 'nurse', 'courier' ];
const PLAYER = new THREE.Vector3( 0, 0.12, 0 );

/**
 * The player standing on a straight run of pavement while the simulation
 * resamples it, one reading a minute.
 *
 * @returns rows of { minute, spawned, live, held }: how many people the crowd
 * has out, how many the simulation reports, and the identities they carry.
 */
function session( minutes ) {

	const routes = pavement();
	const sim = resampled();
	const crowd = new Crowd( {
		assets: { variants: [ {}, {} ], durations: [ 1, 1, 1 ], meshesOf: () => [] },
		routes, signals: { green: () => true }, sim,
		places: new Map(), capacity: 200
	} );

	const clock = { timeMin: 780, daySeconds: 46800, seconds: 46800 };
	const rows = [];
	const step = 1 / 10;
	let due = 0;

	for ( let tick = 0; tick <= minutes * 60 / step; tick ++ ) {

		clock.seconds += step;
		clock.timeMin = Math.floor( clock.seconds / 60 );
		clock.daySeconds = clock.seconds % 86400;
		crowd.update( step, PLAYER, clock );

		// read right after a refresh, when the handles are the ones the crowd
		// has just been told about
		if ( crowd.timer !== 0 || tick * step < due ) continue;

		due += 60;

		const held = [];

		for ( const member of crowd.members.values() ) if ( member.crowdId ) held.push( member.crowdId );

		rows.push( {
			minute: Math.round( tick * step / 60 ),
			spawned: crowd.count,
			live: live( sim, clock.timeMin ),
			held
		} );

	}

	return rows;

}

/** Every handle the simulation has out on the pavements around the player. */
function live( sim, timeMin ) {

	const out = [];

	for ( const agent of sim.crowd( timeMin, { kind: 'radius', x: PLAYER.x, z: PLAYER.z, metres: 90 } ).agents ) out.push( agent.crowdId );

	return out;

}

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
 * A simulation whose street handles carry the epoch they were sampled in, and
 * whose street empties and fills through the session the way a real one does.
 */
function resampled() {

	return {
		crowd: ( timeMin, scope ) => {

			const onEdge = ( id ) => {

				const epoch = Math.floor( timeMin / EPOCH );
				const count = timeMin % 10 < 5 ? 4 : 3;
				const agents = [];

				for ( let i = 0; i < count; i ++ ) {

					agents.push( {
						crowdId: `c|${id}|${i}|${epoch}`,
						type: TYPES[ i % TYPES.length ],
						gender: i % 2 ? 'female' : 'male',
						activity: 'commuting',
						place: { kind: 'edge', id },
						progress: ( i + 0.5 ) / count,
						direction: i % 2 ? - 1 : 1
					} );

				}

				return agents;

			};

			if ( scope.kind === 'edge' ) return { agents: onEdge( scope.id ) };
			if ( scope.kind !== 'radius' ) return { agents: [] };

			// The pavement runs along x: a person is inside the circle when the
			// spot their progress puts them at is within reach of its centre.
			const inside = [];

			for ( let i = 0; i < 6; i ++ ) {

				for ( const agent of onEdge( `e${i}` ) ) {

					const x = - 120 + i * 40 + agent.progress * 40;

					if ( Math.abs( x - scope.x ) <= scope.metres ) inside.push( agent );

				}

			}

			return { agents: inside };

		}
	};

}

/**
 * The body a person walks in is the one the simulation says they have, so
 * the woman the player talks to was a woman on the way over as well.
 */
describe( 'Crowd bodies', () => {

	it( 'gives every person the body of their gender', () => {

		const routes = pavement();
		const crowd = new Crowd( {
			assets: { variants: [ {}, {} ], durations: [ 1, 1, 1 ], meshesOf: () => [] },
			routes, signals: { green: () => true }, sim: resampled(),
			places: new Map(), capacity: 200
		} );
		const clock = { timeMin: 780, daySeconds: 46800, seconds: 46800 };

		for ( let tick = 0; tick < 50; tick ++ ) crowd.update( 0.1, PLAYER, clock );

		const walking = [ ...crowd.members.values() ].filter( ( member ) => member.crowdId );

		expect( walking.length ).toBeGreaterThan( 0 );

		for ( const member of walking ) {

			const index = Number( member.crowdId.split( '|' )[ 2 ] );

			expect( member.variant ).toBe( index % 2 ? 1 : 0 );

		}

	} );

	it( 'removes only the focused hero from the baked crowd draw', () => {

		const commits = [];
		const mesh = { setInstance: vi.fn(), commit: ( count ) => commits.push( count ) };
		const crowd = new Crowd( {
			assets: { variants: [ {} ], durations: [ 1 ], meshesOf: () => [ mesh ] },
			routes: null, signals: null, sim: null, places: new Map(), capacity: 4
		} );
		crowd.timer = 0;
		crowd.members.set( 'baked', stationaryMember( false ) );
		crowd.members.set( 'hero', stationaryMember( true ) );

		crowd.update( 0.1, PLAYER, { timeMin: 780, daySeconds: 46800 } );

		expect( mesh.setInstance ).toHaveBeenCalledOnce();
		expect( commits.at( - 1 ) ).toBe( 1 );

	} );

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

function stationaryMember( hero ) {

	return {
		variant: 0, hero, stationary: true, frozen: true, frame: 0, clip: 0,
		position: new THREE.Vector3(), heading: 0, look: {}
	};

}

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
