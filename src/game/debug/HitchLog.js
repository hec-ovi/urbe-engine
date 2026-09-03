/** A frame-to-frame gap this long is felt as a freeze while walking. */
const HITCH_MS = 40;

/**
 * Names the freezes. Every subsystem that does a lump of work in one go notes
 * it here with its cost; when the gap between two frames runs past the
 * threshold, the notes taken during that gap are printed with it. A hitch with
 * no note is work the world did not do itself: a pipeline compile, a GC pause.
 *
 * `count` and `worst` are the run's own answer to "did it stall", which the HUD
 * carries so a screenshot says it without a console open.
 */
export class HitchLog {

	constructor( threshold = HITCH_MS ) {

		this.threshold = threshold;
		this.notes = [];
		this.count = 0;
		/** The longest gap of the run, which is what "did it stall" means. */
		this.worst = 0;

	}

	/** @param ms the cost of that step, when it was timed */
	note( what, ms ) {

		this.notes.push( ms === undefined ? what : `${what} ${ms.toFixed( 0 )} ms` );

	}

	/** Runs synchronous frame work and records it only when its own cost is material. */
	time( what, work, threshold = 4 ) {

		const started = performance.now();
		const result = work();
		const elapsed = performance.now() - started;

		if ( elapsed >= threshold ) this.note( what, elapsed );

		return result;

	}

	/** Called once per frame with the gap since the previous one. */
	frame( gapMs ) {

		if ( gapMs > this.threshold ) {

			this.count ++;
			this.worst = Math.max( this.worst, gapMs );
			console.info( `hitch ${gapMs.toFixed( 0 )} ms: ${this.notes.join( ', ' ) || 'no world event in this gap'}` );

		}

		this.notes.length = 0;

	}

}
