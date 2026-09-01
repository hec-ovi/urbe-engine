/** A frame-to-frame gap this long is felt as a freeze while walking. */
const HITCH_MS = 40;

/**
 * Names the freezes. Every subsystem that does a lump of work in one go notes
 * it here with its cost; when the gap between two frames runs past the
 * threshold, the notes taken during that gap are printed with it. A hitch with
 * no note is work the world did not do itself: a pipeline compile, a GC pause.
 */
export class HitchLog {

	constructor( threshold = HITCH_MS ) {

		this.threshold = threshold;
		this.notes = [];
		this.count = 0;

	}

	/** @param ms the cost of that step, when it was timed */
	note( what, ms ) {

		this.notes.push( ms === undefined ? what : `${what} ${ms.toFixed( 0 )} ms` );

	}

	/** Called once per frame with the gap since the previous one. */
	frame( gapMs ) {

		if ( gapMs > this.threshold ) {

			this.count ++;
			console.info( `hitch ${gapMs.toFixed( 0 )} ms: ${this.notes.join( ', ' ) || 'no world event in this gap'}` );

		}

		this.notes.length = 0;

	}

}
