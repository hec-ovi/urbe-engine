import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { Crowd } from './Crowd.js';

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
