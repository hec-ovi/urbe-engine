/** How often a running stage repeats itself, in milliseconds. */
const TICK = 500;
/** Below this a stage is over before anyone reads it, so it says no time. */
const PATIENCE_MS = 1500;

/**
 * What the preview is doing, said out loud while it does it.
 *
 * A black viewport with no message is indistinguishable from a broken one, and
 * the slow stages here are the ones a machine can be slow at for real reasons:
 * decoding a hundred maps, compiling that many pipelines. So each stage names
 * itself, counts its own progress where it has a count, and keeps saying so on
 * a timer rather than on an animation frame, because a browser stops frames
 * for a window it cannot see and the frames are exactly what may have stopped.
 */
export class PreviewProgress {

	/** @param say (text) => void, where the preview puts its status line */
	constructor( say ) {

		this.say = say;
		this.marks = [];
		this.stage = null;
		this.detail = '';
		this.started = 0;
		this.timer = null;

	}

	/** Runs one named stage, saying so until it settles. @returns the work's result */
	async run( name, work ) {

		this.stage = name;
		this.detail = '';
		this.started = performance.now();
		this.#speak();
		this.timer = setInterval( () => this.#speak(), TICK );

		try {

			return await work();

		} finally {

			clearInterval( this.timer );
			this.timer = null;
			this.marks.push( { name, ms: Math.round( performance.now() - this.started ) } );
			this.stage = null;

		}

	}

	/** How far the running stage has got, when it can count. */
	step( done, total ) {

		this.detail = `${done} of ${total}`;

	}

	/** Every stage that has run, with the milliseconds it took. */
	get timeline() {

		return this.marks.map( ( { name, ms } ) => `${name} ${ms}ms` ).join( ' · ' );

	}

	#speak() {

		const elapsed = performance.now() - this.started;
		const parts = [ this.stage ];
		if ( this.detail ) parts.push( this.detail );
		if ( elapsed >= PATIENCE_MS ) parts.push( `${Math.round( elapsed / 1000 )}s` );
		this.say( parts.join( ' · ' ) );

	}

}
