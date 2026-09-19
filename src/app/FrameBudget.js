import { eventLoopTurn, frameYield } from './FrameYield.js';

/** How long work may hold the main thread before the display gets it back. */
const SLICE_MS = 4;

/**
 * A few milliseconds of main thread at a time, then the display gets its turn.
 *
 * Work that runs while the city is playing is cut into steps and asks here
 * between them. The budget only yields once a slice is spent, so a run of cheap
 * steps costs a clock reading each and a step that overruns hands the frame
 * back straight after it. What bounds a hitch is the size of one step; what
 * this bounds is how many of them land in the same frame.
 *
 * What that turn is depends on whether the city is drawn. Playing, it is a
 * frame: the display has something to lose. Loading, there is no frame to
 * protect and waiting for one would stretch the load by the length of every
 * yield in it, so the turn is one pass of the event loop, which is enough to
 * keep the loading view drawing and its counters moving. `pace` is what says
 * the display has something to lose now.
 */
export class FrameBudget {

	/**
	 * @param slice milliseconds this may hold before yielding
	 * @param paced false while there is no frame to protect, as during a load
	 */
	constructor( { slice = SLICE_MS, paced = true } = {} ) {

		this.slice = slice;
		this.paced = paced;
		this.since = performance.now();
		/** The longest this budget has held the main thread, for diagnostics. */
		this.max = 0;

	}

	/** Starts giving the display its turn: there is a frame to protect now. */
	pace() {

		this.paced = true;
		this.restart();

	}

	/** Starts a fresh slice, after work that was not on this budget. */
	restart() {

		this.since = performance.now();

	}

	/** Hands the rest of the system its turn when this slice is spent. */
	async step() {

		const held = performance.now() - this.since;
		this.max = Math.max( this.max, held );
		if ( held < this.slice ) return;

		await ( this.paced ? frameYield() : eventLoopTurn() );
		this.restart();

	}

}
