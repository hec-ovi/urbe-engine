import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { Crowd } from './Crowd.js';
import { WalkRoutes } from './WalkRoutes.js';

/**
 * People are not physics bodies, so the crowd's own pushback is the only thing
 * standing between the player and walking through a pedestrian. It has to
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

	for ( let i = 0; i <= 6; i ++ ) nodes.push( { id: `n${i}`, x: - 120 + i * 40, z: 0, kind: 'sidewalk' } );

	for ( let i = 0; i < 6; i ++ ) {

		edges.push( {
			id: `e${i}`, from: `n${i}`, to: `n${i + 1}`, kind: 'sidewalk',
			path: [ [ nodes[ i ].x, 0 ], [ nodes[ i + 1 ].x, 0 ] ]
		} );

	}

	return new WalkRoutes( { walk: { nodes, edges } } );

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
