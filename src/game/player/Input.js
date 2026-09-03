const MOVE_KEYS = {
	KeyW: 'forward', ArrowUp: 'forward',
	KeyS: 'back', ArrowDown: 'back',
	KeyA: 'left', ArrowLeft: 'left',
	KeyD: 'right', ArrowRight: 'right'
};

const GAME_KEYS = new Set( [ ...Object.keys( MOVE_KEYS ), 'Space', 'KeyC', 'KeyE', 'KeyR', 'ShiftLeft', 'ShiftRight' ] );

/**
 * Keyboard and pointer state, and nothing more. Mouse deltas accumulate
 * between frames and are drained by whoever reads them, so a slow frame never
 * loses a flick of the mouse.
 */
export class Input {

	constructor( element ) {

		this.element = element;
		this.keys = new Set();
		this.dx = 0;
		this.dy = 0;
		this.locked = false;
		this.pressed = new Set();
		this.onLockChange = null;

		this.handlers = {
			keydown: ( event ) => {

				if ( event.repeat ) return;
				if ( this.locked && GAME_KEYS.has( event.code ) ) event.preventDefault?.();

				this.keys.add( event.code );
				this.pressed.add( event.code );

			},
			keyup: ( event ) => this.keys.delete( event.code ),
			blur: () => this.clear(),
			mousemove: ( event ) => {

				if ( ! this.locked ) return;

				this.dx += event.movementX;
				this.dy += event.movementY;

			},
			pointerlockchange: () => {

				this.locked = document.pointerLockElement === this.element;
				if ( ! this.locked ) this.clear();
				this.onLockChange?.( this.locked );

			}
		};

		window.addEventListener( 'keydown', this.handlers.keydown );
		window.addEventListener( 'keyup', this.handlers.keyup );
		window.addEventListener( 'blur', this.handlers.blur );
		document.addEventListener( 'mousemove', this.handlers.mousemove );
		document.addEventListener( 'pointerlockchange', this.handlers.pointerlockchange );

	}

	requestLock() {

		this.element.requestPointerLock?.();

	}

	exitLock() {

		document.exitPointerLock?.();

	}

	/** @returns { x, z } in the -1..1 range, camera-relative. */
	axis() {

		let x = 0;
		let z = 0;

		for ( const code of this.keys ) {

			switch ( MOVE_KEYS[ code ] ) {

				case 'forward': z -= 1; break;
				case 'back': z += 1; break;
				case 'left': x -= 1; break;
				case 'right': x += 1; break;

			}

		}

		const length = Math.hypot( x, z );

		return length > 1 ? { x: x / length, z: z / length } : { x, z };

	}

	get running() {

		return this.keys.has( 'ShiftLeft' ) || this.keys.has( 'ShiftRight' );

	}

	get crouching() {

		return this.keys.has( 'KeyC' );

	}

	/** True once per physical press. */
	consume( code ) {

		return this.pressed.delete( code );

	}

	/** @returns accumulated mouse delta, reset to zero. */
	drainLook() {

		const delta = { dx: this.dx, dy: this.dy };
		this.dx = 0;
		this.dy = 0;

		return delta;

	}

	endFrame() {

		this.pressed.clear();

	}

	clear() {

		this.keys.clear();
		this.pressed.clear();
		this.dx = 0;
		this.dy = 0;

	}

	dispose() {

		window.removeEventListener( 'keydown', this.handlers.keydown );
		window.removeEventListener( 'keyup', this.handlers.keyup );
		window.removeEventListener( 'blur', this.handlers.blur );
		document.removeEventListener( 'mousemove', this.handlers.mousemove );
		document.removeEventListener( 'pointerlockchange', this.handlers.pointerlockchange );

	}

}
