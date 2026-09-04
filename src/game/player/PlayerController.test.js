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

	it( 'selects doubled and quadrupled running without changing walking or crouching', () => {

		const { controller, body, press, release } = harness();
		press( 'KeyW' );
		press( 'ShiftLeft' );
		for ( const multiplier of [ 2, 4, 1 ] ) {

			press( `Digit${multiplier}` );
			const before = body.position.z;
			controller.update( 0.5 );
			expect( before - body.position.z ).toBeCloseTo( RUN_SPEED * multiplier * 0.5 );

		}
		press( 'Digit4' );
		release( 'ShiftLeft' );
		const before = body.position.z;
		controller.update( 1 );
		expect( before - body.position.z ).toBeCloseTo( 1.4 );
		press( 'ShiftLeft' );
		press( 'KeyC' );
		controller.update( 1 );
		expect( controller.speed ).toBeCloseTo( CROUCH_SPEED );

	} );

	it( 'zooms while right mouse is held and restores the view on release or unlock', () => {

		const { controller, input, fire, mouse } = harness();
		const original = controller.camera.projectionMatrix.clone();
		fire( 'mousedown', { button: 2 } );
		mouse( 20, 0 );
		controller.update( 1 / 60 );
		expect( controller.camera.zoom ).toBeGreaterThan( 1 );
		expect( controller.camera.zoom ).toBeLessThan( 2 );
		expect( controller.yaw ).toBeCloseTo( - 20 * 0.0022 / controller.camera.zoom );
		expect( controller.camera.projectionMatrix.equals( original ) ).toBe( false );
		fire( 'mouseup', { button: 2 } );
		const zoomed = controller.camera.zoom;
		controller.update( 1 / 60 );
		expect( controller.camera.zoom ).toBeLessThan( zoomed );
		expect( controller.camera.zoom ).toBeGreaterThan( 1 );
		for ( let i = 0; i < 30; i ++ ) controller.update( 1 / 60 );
		expect( controller.camera.projectionMatrix.equals( original ) ).toBe( true );
		fire( 'mousedown', { button: 2 } );
		controller.update( 1 / 60 );
		fire( 'pointerlockchange', {} );
		controller.update( 0 );
		expect( input.zooming ).toBe( false );
		expect( controller.camera.zoom ).toBe( 1 );

	} );

	it( 'uses the same zoom transition at different frame rates', () => {

		const slow = harness();
		const fast = harness();
		slow.fire( 'mousedown', { button: 2 } );
		fast.fire( 'mousedown', { button: 2 } );
		for ( let i = 0; i < 6; i ++ ) slow.controller.update( 1 / 30 );
		for ( let i = 0; i < 12; i ++ ) fast.controller.update( 1 / 60 );
		expect( slow.controller.camera.zoom ).toBeCloseTo( fast.controller.camera.zoom, 10 );
		expect( slow.controller.camera.zoom ).toBeGreaterThan( 1.95 );

	} );

	it( 'keeps mouse look but ignores walking, jumping and crouching while carried', () => {

		const { controller, body, press, mouse } = harness();
		controller.beginRide( [ 10, -12, 4 ], [ 1, 0 ] );
		const rideYaw = controller.yaw;
		press( 'KeyW' );
		press( 'KeyC' );
		press( 'Space' );
		mouse( 20, -10 );
		controller.update( 0.5 );

		expect( body.feet.toArray() ).toEqual( [ 10, -12, 4 ] );
		expect( body.moves ).toBe( 0 );
		expect( body.jumps ).toBe( 0 );
		expect( body.crouched ).toBe( false );
		expect( controller.yaw ).not.toBe( rideYaw );

		controller.carry( [ 12, -12, 6 ], [ 0, 1 ] );
		expect( body.feet.toArray() ).toEqual( [ 12, -12, 6 ] );
		controller.endRide( [ 20, 0, 8 ] );
		expect( body.feet.toArray() ).toEqual( [ 20, 0, 8 ] );
		expect( controller.movementLocked ).toBe( false );

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
		input,
		fire: ( type, event ) => listeners.get( type )( event ),
		body,
		press: ( code ) => listeners.get( 'keydown' )( { code, repeat: false } ),
		release: ( code ) => listeners.get( 'keyup' )( { code } ),
		mouse: ( movementX, movementY ) => listeners.get( 'mousemove' )( { movementX, movementY } )
	};

}

/** Physics stands in as a body that always allows the move it is asked for. */
class StubBody {

	constructor() {

		this.position = new THREE.Vector3();
		this.grounded = true;
		this.crouched = false;
		this.jumps = 0;
		this.moves = 0;
		this.carried = false;

	}

	get feet() {

		return this.position.clone();

	}

	get eye() {

		return this.position.clone().setY( this.position.y + 1.7 );

	}

	move( offset ) {

		this.moves ++;
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

	beginCarry( point ) {

		this.carried = true;
		this.position.copy( point );

	}

	carryTo( point ) {

		this.position.copy( point );

	}

	endCarry( point ) {

		this.carried = false;
		this.position.copy( point );

	}

}

function round( value ) {

	return Math.abs( value ) < 1e-6 ? 0 : Number( value.toFixed( 4 ) );

}
