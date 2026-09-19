/**
 * The loading screen's one counter, and where its time went.
 *
 * A counter that restarts at one for every cell, batch or page says nothing
 * about how far the city has got, so there is a single tally for the whole
 * load: one unit per named step, plus one for every program a preparation pass
 * declares. Each pass takes a handle of its own and reports against it, so the
 * same pass running for several groups still counts once per unit of work.
 *
 * Steps are timed. With the debug switch on, the timeline prints when the load
 * ends, which is what a slow load is read from.
 */
export class LoadProgress {

	/**
	 * @param report receives the line the loading view shows
	 * @param log true to print the step timeline when the load ends
	 */
	constructor( report, { log = false, now = () => performance.now() } = {} ) {

		this.report = report;
		this.log = log;
		this.now = now;
		this.total = 0;
		this.done = 0;
		this.label = 'starting';
		this.stepLabel = 'starting';
		this.steps = [];
		this.jobs = [];
		this.started = this.now();
		this.at = this.started;

	}

	/** Work this load is going to do, declared as each pass learns its size. */
	plan( units ) {

		this.total += Math.max( 0, units );
		this.#show();

		return this;

	}

	/** Names the pass now running, and closes the one before it. */
	step( label ) {

		this.#close();
		this.stepLabel = label;
		this.label = label;
		this.#show();

		return this;

	}

	/**
	 * Times one job running beside the steps, for the timeline. Its failure
	 * still surfaces wherever the job is awaited.
	 */
	timed( label, work ) {

		const started = this.now();
		const record = () => this.jobs.push( [ label, this.now() - started ] );
		const timing = Promise.resolve( work ).then(
			( value ) => {

				record();
				return value;

			},
			( error ) => {

				record();
				throw error;

			}
		);
		timing.catch( () => {} );

		return timing;

	}

	/** One pass's own counter: `at(done, total)` as it works through its units. */
	pass( label ) {

		let counted = 0;
		let planned = 0;

		return {
			at: ( done, total ) => {

				if ( total > planned ) {

					this.total += total - planned;
					planned = total;

				}
				if ( done > counted ) {

					this.done += done - counted;
					counted = done;

				}
				this.label = label;
				this.#show();

			}
		};

	}

	/** Units of this step finished. */
	advance( units = 1 ) {

		this.done += units;
		this.#show();

		return this;

	}

	/** The load is over: closes the last step and prints the timeline. */
	finish() {

		this.#close();
		if ( ! this.log ) return this.steps;
		const total = ( this.now() - this.started ) / 1000;
		for ( const [ label, ms ] of [ ...this.steps, ...this.jobs ] ) console.info( `load ${( ms / 1000 ).toFixed( 2 )} s  ${label}` );
		console.info( `load ${total.toFixed( 2 )} s total, ${this.done} work units` );

		return this.steps;

	}

	#close() {

		const now = this.now();
		if ( this.steps.length || this.stepLabel !== 'starting' ) {

			this.steps.push( [ this.stepLabel, now - this.at ] );
			this.done ++;

		}
		this.at = now;

	}

	#show() {

		this.report( this.total ? `${this.label} ${Math.min( this.done, this.total )} / ${this.total}` : this.label );

	}

}
