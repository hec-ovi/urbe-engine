/** A frame at 30 Hz: long enough that a drawing page always wins the race. */
const WITHOUT_FRAMES_MS = 32;

/**
 * Hands the display a chance to draw, then carries on.
 *
 * Loading work paces itself one piece per frame so the page stays alive while
 * it runs. The catch is that frames are not guaranteed: a browser stops
 * `requestAnimationFrame` for a tab in the background or a window behind
 * another one, and work that waits for the next frame then waits for ever,
 * silently. So the wait is bounded in both directions:
 *
 * - drawing, or merely covered up: the next frame, or 32 ms, whichever first;
 * - hidden outright: one turn of the event loop, because there is no frame to
 *   protect and a background tab clamps its timers to one a second.
 */
export function frameYield() {

	if ( typeof document !== 'undefined' && document.visibilityState === 'hidden' ) return eventLoopTurn();

	return new Promise( ( resolve ) => {

		let settled = false;
		const settle = () => {

			if ( settled ) return;
			settled = true;
			resolve();

		};

		if ( typeof requestAnimationFrame === 'function' ) requestAnimationFrame( settle );
		setTimeout( settle, WITHOUT_FRAMES_MS );

	} );

}

/** A turn of the event loop that a background tab does not slow to one a second. */
export function eventLoopTurn() {

	return new Promise( ( resolve ) => {

		if ( typeof MessageChannel !== 'function' ) {

			setTimeout( resolve, 0 );
			return;

		}

		const channel = new MessageChannel();
		channel.port1.onmessage = () => {

			channel.port1.close();
			resolve();

		};
		channel.port2.postMessage( 0 );

	} );

}
