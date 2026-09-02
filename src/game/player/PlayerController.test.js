import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { Input } from './Input.js';
import { CROUCH_SPEED, PlayerController, RUN_SPEED } from './PlayerController.js';

/**
 * The controller promises WASD on the ground plane, camera relative. Inverted
 * movement is the one failure a player notices in the first second, so each
 * key is asserted against the sign of the move it produces.
 */
describe( 'PlayerController', () => {

	it( 'moves the body the way the key points, at yaw 0', () => {

		const cases = [
			[ 'KeyW', { x: 0, z: - 1 } ],
			[ 'KeyS', { x: 0, z: 1 } ],
			[ 'KeyA', { x: - 1, z: 0 } ],
			[ 'KeyD', { x: 1, z: 0 } ]
		];

		for ( const [ code, direction ] of cases ) {

			const { controller, body, press } = harness();

			press( code );
			controller.update( 0.5 );

			expect( Math.sign( round( body.position.x ) ), `${code} x` ).toBe( direction.x );
			expect( Math.sign( round( body.position.z ) ), `${code} z` ).toBe( direction.z );

		}

	} );

	it( 'walks forward along the direction the camera looks', () => {

		const { controller, body, press } = harness();

		controller.yaw = Math.PI / 2; // looking down -X
		press( 'KeyW' );
		controller.update( 0.5 );

		expect( Math.sign( round( body.position.x ) ) ).toBe( - 1 );
		expect( round( body.position.z ) ).toBe( 0 );

	} );

	it( 'sprints while shift is held and crouches to the shorter speed', () => {

		const sprint = harness();
		sprint.press( 'KeyW' );
		sprint.press( 'ShiftLeft' );
		sprint.controller.update( 0.5 );

		expect( sprint.body.position.z ).toBeCloseTo( - RUN_SPEED * 0.5 );

		const crouch = harness();
		crouch.press( 'KeyW' );
		crouch.press( 'ShiftLeft' );
		crouch.press( 'KeyC' );
		crouch.controller.update( 0.5 );

		expect( crouch.body.crouched ).toBe( true );
		expect( crouch.body.position.z ).toBeCloseTo( - CROUCH_SPEED * 0.5 );

	} );

	it( 'starts one jump from one physical space press', () => {

		const { controller, body, press } = harness();

		press( 'Space' );
		controller.update( 1 / 60 );
		controller.update( 1 / 60 );

		expect( body.jumps ).toBe( 1 );

	} );

} );

function harness() {

	const listeners = new Map();
	const target = {
		addEventListener: ( type, handler ) => listeners.set( type, handler ),
		removeEventListener: () => {}
	};

	vi.stubGlobal( 'window', target );
	vi.stubGlobal( 'document', { ...target, pointerLockElement: null } );

	const input = new Input( {} );
	input.locked = true;

	const body = new StubBody();
	const controller = new PlayerController( {
		body,
		camera: new THREE.PerspectiveCamera(),
		input
	} );

	return {
		controller,
		body,
		press: ( code ) => listeners.get( 'keydown' )( { code, repeat: false } ),
		release: ( code ) => listeners.get( 'keyup' )( { code } )
	};

}

/** Physics stands in as a body that always allows the move it is asked for. */
class StubBody {

	constructor() {

		this.position = new THREE.Vector3();
		this.grounded = true;
		this.crouched = false;
		this.jumps = 0;

	}

	get feet() {

		return this.position.clone();

	}

	get eye() {

		return this.position.clone().setY( this.position.y + 1.7 );

	}

	move( offset ) {

		this.position.add( offset );

	}

	setCrouched( wanted ) {

		this.crouched = wanted;
		return true;

	}

	jump() {

		if ( ! this.grounded || this.crouched ) return false;
		this.jumps ++;
		this.grounded = false;
		return true;

	}

}

function round( value ) {

	return Math.abs( value ) < 1e-6 ? 0 : Number( value.toFixed( 4 ) );

}
