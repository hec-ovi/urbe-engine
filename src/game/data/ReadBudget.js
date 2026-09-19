/** What a city opens at once, unless its owner asks for something else. */
const DEPTH = 8;

/**
 * One depth of reads in flight, shared by everything that reads through it.
 *
 * A city reads hundreds of documents and files from one host. Letting every
 * consumer open as many as it likes buries the file somebody is waiting for
 * under the ones nobody is waiting for yet, so reads queue here in the order
 * they were asked for and only so many are ever in flight.
 */
export class ReadBudget {

	constructor( depth = DEPTH ) {

		this.depth = depth;
		this.active = 0;
		this.queue = [];

	}

	/** Runs this read when the budget has room. @returns whatever it returns */
	run( read ) {

		return new Promise( ( resolve, reject ) => {

			this.queue.push( { read, resolve, reject } );
			this.#drain();

		} );

	}

	#drain() {

		while ( this.active < this.depth && this.queue.length ) {

			const { read, resolve, reject } = this.queue.shift();
			this.active ++;
			Promise.resolve().then( read ).then( resolve, reject ).finally( () => {

				this.active --;
				this.#drain();

			} );

		}

	}

}
