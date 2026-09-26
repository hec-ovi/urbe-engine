import { randomUUID } from 'node:crypto';
import { LauncherServiceError } from './LauncherService.js';

/** The launcher methods that build, which a creation job runs. */
export const CREATION_METHODS = Object.freeze( [ 'generateCity', 'generateInstances', 'generateQuests', 'createGame' ] );

/**
 * Creation stages in the background. A stage can run for most of an hour (a
 * city named and a story written through the model server), so a client
 * submits it, gets its job at once and reads the job until it settles. Jobs
 * run one at a time in submission order: every stage reads and writes the
 * shared catalog, and the stages of one game depend on the ones before.
 */
export class CreationJobs {

	#jobs = new Map();
	#tail = Promise.resolve();

	/**
	 * @param service the LauncherService whose methods the jobs run
	 * @param creation the world creation that checks a stage's input before it queues
	 * @param maxPending jobs waiting or running at once
	 * @param maxKept jobs kept for reading, the oldest settled ones going first
	 */
	constructor( { service, creation, maxPending = 4, maxKept = 32, clock = () => new Date() } ) {

		this.service = service;
		this.creation = creation;
		this.maxPending = maxPending;
		this.maxKept = maxKept;
		this.clock = clock;

	}

	/** Queues one stage after checking its input. @returns the queued job */
	start( request ) {

		if ( ! request || typeof request !== 'object' || ! CREATION_METHODS.includes( request.method ) ) {

			throw new LauncherServiceError( 'E_INVALID_REQUEST', `a creation job runs one of ${CREATION_METHODS.join( ', ' )}` );

		}
		if ( ! this.creation ) throw new LauncherServiceError( 'E_CREATION_UNAVAILABLE', `${request.method} is not connected`, 503 );
		this.creation.check( request.method, request.input );
		const pending = [ ...this.#jobs.values() ].filter( ( { job } ) => job.state === 'queued' || job.state === 'running' );
		if ( pending.length >= this.maxPending ) {

			throw new LauncherServiceError( 'E_BUSY', `${pending.length} creation jobs are already waiting or running`, 429 );

		}

		const job = {
			id: `creation-${randomUUID()}`, method: request.method, state: 'queued',
			submittedAt: this.clock().toISOString(), startedAt: null, finishedAt: null, progress: null, result: null, error: null
		};
		const record = { job, input: structuredClone( request.input ) };
		this.#jobs.set( job.id, record );
		this.#forget();
		this.#tail = this.#tail.then( () => this.#run( record ) );
		return structuredClone( job );

	}

	get( id ) {

		const record = this.#jobs.get( id );
		if ( ! record ) throw new LauncherServiceError( 'E_JOB_NOT_FOUND', 'creation job was not found in this server session', 404 );
		return structuredClone( record.job );

	}

	async #run( record ) {

		const { job } = record;
		job.state = 'running';
		job.startedAt = this.clock().toISOString();
		try {

			job.result = await this.service[ job.method ]( record.input, { progress: ( line ) => job.progress = line } );
			job.state = 'succeeded';

		} catch ( error ) {

			job.state = 'failed';
			job.error = { code: error?.code ?? 'E_LAUNCHER', message: error?.message || String( error ) };

		} finally {

			job.finishedAt = this.clock().toISOString();
			record.input = null;

		}

	}

	/** Lets the oldest settled jobs go once more are kept than asked; a waiting or running one stays. */
	#forget() {

		for ( const [ id, { job } ] of this.#jobs ) {

			if ( this.#jobs.size <= this.maxKept ) return;
			if ( job.state === 'succeeded' || job.state === 'failed' ) this.#jobs.delete( id );

		}

	}

}
