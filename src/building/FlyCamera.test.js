// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { FlyCamera } from './FlyCamera.js';

function rig() {

	const element = new EventTarget();
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

	it( 'looks around while dragging', () => {

		const { element, camera, fly } = rig();
		const forward = () => new THREE.Vector3( 0, 0, - 1 ).applyQuaternion( camera.quaternion );

		element.dispatchEvent( Object.assign( new Event( 'pointermove' ), { movementX: 200, movementY: 0 } ) );
		expect( forward().z ).toBeCloseTo( - 1, 3 );

		element.dispatchEvent( Object.assign( new Event( 'pointerdown' ), { pointerId: 1 } ) );
		element.dispatchEvent( Object.assign( new Event( 'pointermove' ), { movementX: 200, movementY: 0 } ) );
		// dragging right turns the view right
		expect( forward().x ).toBeGreaterThan( 0.5 );
		fly.dispose();

	} );

} );
