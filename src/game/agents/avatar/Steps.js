/**
 * Tailoring is written as generators that yield between steps of a few
 * milliseconds. Played, the frame budget gets its say at every yield, so a
 * person built while the city plays never holds a frame; in a test or a load
 * with nothing to protect they run straight through.
 */

/** Runs the steps, asking `slice` (FrameBudget) between them. */
export async function stepped( steps, slice = null ) {

	let next = steps.next();
	while ( ! next.done ) {

		if ( slice ) await slice.step();
		next = steps.next();

	}
	return next.value;

}

/** Runs the steps through in one go. */
export function whole( steps ) {

	let next = steps.next();
	while ( ! next.done ) next = steps.next();
	return next.value;

}
