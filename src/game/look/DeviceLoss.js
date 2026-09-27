/** Where the tab remembers when a lost device last reloaded it; it lives as long as the tab. */
const RELOADED = 'urbe.deviceLoss.reloadedAt';
/**
 * A reset this soon after the last automatic reload is taken as one that comes
 * back: the page stops reloading by itself, so a hang that returns cannot keep
 * resetting the whole GPU, and every compute job on it, with nobody watching.
 */
export const RELOAD_CALM_MS = 10 * 60 * 1000;

/**
 * A GPU reset takes the drawing context and everything uploaded to it, and the
 * renderer cannot rebuild them; the world the page holds in memory survives.
 * On the first loss drawing stops and the game is saved where it stands. The
 * page reloads to resume from that save, by itself unless it did so within
 * RELOAD_CALM_MS, and then on the player's next key or click. A save that
 * fails still reloads.
 */
export function recoverDeviceLoss( renderer, {
	save = () => null,
	notify = () => {},
	reload = () => location.reload(),
	storage = session(),
	now = Date.now,
	nextInput = anyInput
} = {} ) {

	// Three's own handler reports the loss and stops the renderer drawing into the dead context.
	const report = renderer.onDeviceLost?.bind( renderer );
	let lost = false;
	renderer.onDeviceLost = async ( info = {} ) => {

		if ( lost ) return;
		lost = true;
		report?.( info );
		renderer.setAnimationLoop( null );
		const last = Number( read( storage ) );
		const unattended = ! ( now() - last < RELOAD_CALM_MS );
		notify( unattended
			? { title: 'Graphics reset', text: 'The GPU was reset. Saving the game and reloading.' }
			: { title: 'Graphics reset again', text: 'The GPU was reset again. The game is saved; press any key to reload.' } );
		try {

			await save();

		} catch ( error ) {

			console.error( 'could not save after the GPU reset', error );

		}
		if ( ! unattended ) await nextInput();
		write( storage, String( now() ) );
		reload();

	};

}

function session() {

	try {

		return globalThis.sessionStorage ?? null;

	} catch {

		return null;

	}

}

function read( storage ) {

	try {

		return storage?.getItem( RELOADED ) ?? null;

	} catch {

		return null;

	}

}

function write( storage, value ) {

	try {

		storage?.setItem( RELOADED, value );

	} catch {

		// Without the tab's memory every reset reloads by itself, as a first one does.

	}

}

function anyInput() {

	return new Promise( ( resolve ) => {

		const done = () => {

			removeEventListener( 'keydown', done, true );
			removeEventListener( 'pointerdown', done, true );
			resolve();

		};
		addEventListener( 'keydown', done, true );
		addEventListener( 'pointerdown', done, true );

	} );

}
