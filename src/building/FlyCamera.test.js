// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { FlyCamera } from './FlyCamera.js';

function rig() {

	const element = new EventTarget();
	Object.defineProperty( document, 'pointerLockElement', { configurable: true, writable: true, value: null } );
	element.requestPointerLock = vi.fn( () => {

		document.pointerLockElement = element;
		document.dispatchEvent( new Event( 'pointerlockchange' ) );

	} );
	const camera = new THREE.PerspectiveCamera();
	camera.position.set( 0, 2, 10 );
	const fly = new FlyCamera( camera, element );
	fly.lookAt( new THREE.Vector3( 0, 2, 0 ) );
	return { element, camera, fly };

}

afterEach( () => vi.restoreAllMocks() );

describe( 'FlyCamera', () => {

	it( 'walks along the view with W A S D, climbs with E, sinks with Q, and never zooms', () => {

		const { element, camera, fly } = rig();
		const press = ( code ) => window.dispatchEvent( new KeyboardEvent( 'keydown', { code } ) );
		const release = ( code ) => window.dispatchEvent( new KeyboardEvent( 'keyup', { code } ) );

		// a frame is at most a tenth of a second of travel, whatever the clock says
		const frames = ( n ) => { for ( let i = 0; i < n; i ++ ) fly.update( fly.last + 100 ); };

		element.dispatchEvent( new Event( 'click' ) );
		press( 'KeyW' );
		frames( 5 );
		release( 'KeyW' );
		expect( camera.position.z ).toBeCloseTo( 8, 3 );

		press( 'KeyE' );
		frames( 5 );
		release( 'KeyE' );
		expect( camera.position.y ).toBeCloseTo( 4, 3 );

		press( 'KeyQ' );
		press( 'KeyD' );
		frames( 5 );
		release( 'KeyQ' );
		release( 'KeyD' );
		expect( camera.position.y ).toBeCloseTo( 4 - 2 / Math.SQRT2, 3 );
		expect( camera.position.x ).toBeCloseTo( 2 / Math.SQRT2, 3 );

		const before = camera.position.clone();
		element.dispatchEvent( Object.assign( new Event( 'wheel' ), { deltaY: 300 } ) );
		frames( 2 );
		expect( camera.position.equals( before ) ).toBe( true );

	} );

	it( 'captures on viewport click, releases on Escape, and captures again', () => {

		const states = [];
		const { element, camera, fly } = rig();
		fly.onLockChange = ( locked, failed ) => states.push( { locked, failed } );
		const forward = () => new THREE.Vector3( 0, 0, - 1 ).applyQuaternion( camera.quaternion );

		document.dispatchEvent( Object.assign( new Event( 'mousemove' ), { movementX: 200, movementY: 0 } ) );
		expect( forward().z ).toBeCloseTo( - 1, 3 );

		element.dispatchEvent( new Event( 'click' ) );
		expect( element.requestPointerLock ).toHaveBeenCalledTimes( 1 );
		document.dispatchEvent( Object.assign( new Event( 'mousemove' ), { movementX: 200, movementY: 0 } ) );
		expect( forward().x ).toBeGreaterThan( 0.5 );

		document.pointerLockElement = null;
		document.dispatchEvent( new Event( 'pointerlockchange' ) );
		const released = forward().clone();
		document.dispatchEvent( Object.assign( new Event( 'mousemove' ), { movementX: 200, movementY: 0 } ) );
		expect( forward().equals( released ) ).toBe( true );

		element.dispatchEvent( new Event( 'click' ) );
		expect( element.requestPointerLock ).toHaveBeenCalledTimes( 2 );
		expect( states ).toEqual( [
			{ locked: true, failed: false },
			{ locked: false, failed: false },
			{ locked: true, failed: false }
		] );
		fly.dispose();

	} );

	it( 'does not capture when a UI control is clicked', () => {

		const { element, fly } = rig();
		const button = document.createElement( 'button' );
		document.body.append( button );

		button.click();
		expect( element.requestPointerLock ).not.toHaveBeenCalled();
		fly.dispose();

	} );

} );
