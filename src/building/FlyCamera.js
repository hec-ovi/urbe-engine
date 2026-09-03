import * as THREE from 'three/webgpu';

const SPEED = 4;
const FAST = 4;
const LOOK = 0.0035;
const PITCH_LIMIT = Math.PI / 2 - 0.01;

const MOVES = {
	KeyW: [ 0, 0, - 1 ], KeyS: [ 0, 0, 1 ],
	KeyA: [ - 1, 0, 0 ], KeyD: [ 1, 0, 0 ],
	KeyE: [ 0, 1, 0 ], KeyQ: [ 0, - 1, 0 ]
};

/**
 * Walk-anywhere camera for looking at one building: W A S D move along the
 * view, Q and E go down and up, and captured mouse movement looks around.
 * A viewport click enters pointer lock and Escape leaves it. Nothing zooms:
 * the wheel is left alone so a close look is always a walk.
 */
export class FlyCamera {

	constructor( camera, domElement, onLockChange = null ) {

		this.camera = camera;
		this.element = domElement;
		this.keys = new Set();
		this.yaw = 0;
		this.pitch = 0;
		this.fast = false;
		this.locked = document.pointerLockElement === domElement;
		this.onLockChange = onLockChange;
		this.last = performance.now();
		this.handlers = {
			keydown: ( event ) => {

				if ( ! this.locked ) return;
				if ( event.code in MOVES ) this.keys.add( event.code );
				if ( event.key === 'Shift' ) this.fast = true;

			},
			keyup: ( event ) => { this.keys.delete( event.code ); if ( event.key === 'Shift' ) this.fast = false; },
			blur: () => {

				this.clear();
				if ( document.pointerLockElement === this.element ) document.exitPointerLock?.();

			},
			click: () => this.requestLock(),
			mousemove: ( event ) => { if ( this.locked ) this.turn( event.movementX, event.movementY ); },
			pointerlockchange: () => {

				this.locked = document.pointerLockElement === this.element;
				if ( ! this.locked ) this.clear();
				this.onLockChange?.( this.locked, false );

			},
			pointerlockerror: () => {

				this.locked = false;
				this.clear();
				this.onLockChange?.( false, true );

			}
		};
		window.addEventListener( 'keydown', this.handlers.keydown );
		window.addEventListener( 'keyup', this.handlers.keyup );
		window.addEventListener( 'blur', this.handlers.blur );
		domElement.addEventListener( 'click', this.handlers.click );
		document.addEventListener( 'mousemove', this.handlers.mousemove );
		document.addEventListener( 'pointerlockchange', this.handlers.pointerlockchange );
		document.addEventListener( 'pointerlockerror', this.handlers.pointerlockerror );

	}

	/** Face a point from where the camera stands. */
	lookAt( target ) {

		const to = _dir.copy( target ).sub( this.camera.position );
		this.yaw = Math.atan2( - to.x, - to.z );
		this.pitch = Math.atan2( to.y, Math.hypot( to.x, to.z ) );
		this.#orient();

	}

	turn( dx, dy ) {

		this.yaw -= dx * LOOK;
		this.pitch = THREE.MathUtils.clamp( this.pitch - dy * LOOK, - PITCH_LIMIT, PITCH_LIMIT );
		this.#orient();

	}

	requestLock() {

		if ( this.locked ) return;

		try {

			if ( ! this.element.requestPointerLock ) return this.handlers.pointerlockerror();
			const pending = this.element.requestPointerLock();
			pending?.catch?.( () => this.handlers.pointerlockerror() );

		} catch {

			this.handlers.pointerlockerror();

		}

	}

	/** One frame of movement; the animation loop calls it with no arguments. */
	update( now = performance.now() ) {

		const delta = Math.min( 0.1, ( now - this.last ) / 1000 );
		this.last = now;
		if ( this.keys.size === 0 ) return;

		_move.set( 0, 0, 0 );
		for ( const code of this.keys ) _move.add( _step.fromArray( MOVES[ code ] ) );
		if ( _move.lengthSq() === 0 ) return;

		const up = _move.y;
		_move.y = 0;
		_move.applyQuaternion( this.camera.quaternion );
		_move.y += up;
		this.camera.position.addScaledVector( _move.normalize(), SPEED * ( this.fast ? FAST : 1 ) * delta );

	}

	#orient() {

		this.camera.quaternion.setFromEuler( _euler.set( this.pitch, this.yaw, 0, 'YXZ' ) );

	}

	clear() {

		this.keys.clear();
		this.fast = false;

	}

	dispose() {

		window.removeEventListener( 'keydown', this.handlers.keydown );
		window.removeEventListener( 'keyup', this.handlers.keyup );
		window.removeEventListener( 'blur', this.handlers.blur );
		this.element.removeEventListener( 'click', this.handlers.click );
		document.removeEventListener( 'mousemove', this.handlers.mousemove );
		document.removeEventListener( 'pointerlockchange', this.handlers.pointerlockchange );
		document.removeEventListener( 'pointerlockerror', this.handlers.pointerlockerror );

	}

}

const _dir = new THREE.Vector3();
const _move = new THREE.Vector3();
const _step = new THREE.Vector3();
const _euler = new THREE.Euler();
