/**
 * A GPU reset takes the drawing context and everything uploaded to it, and the
 * renderer cannot rebuild them; the world the page holds in memory survives.
 * On the first loss drawing stops, the player is told, the game is saved where
 * it stands and the page reloads, so the save resumes play instead of leaving a
 * dead tab. A save that fails still reloads.
 */
export function recoverDeviceLoss( renderer, { save = () => null, notify = () => {}, reload = () => location.reload() } = {} ) {

	// Three's own handler reports the loss and stops the renderer drawing into the dead context.
	const report = renderer.onDeviceLost?.bind( renderer );
	let lost = false;
	renderer.onDeviceLost = async ( info = {} ) => {

		if ( lost ) return;
		lost = true;
		report?.( info );
		renderer.setAnimationLoop( null );
		notify( info );
		try {

			await save();

		} catch ( error ) {

			console.error( 'could not save after the GPU reset', error );

		}
		reload();

	};

}
