import { Worker } from 'node:worker_threads';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonFile } from './JsonFile.js';
import { AssemblyError } from './RequestAssembler.js';

/** Streets read the blueprint alone, so they build while the shells do. */
export class StreetsAhead {

	constructor( directory, atlas, options = {} ) {

		mkdirSync( directory, { recursive: true } );
		this.stage = mkdtempSync( join( directory, '.streets-' ) );
		writeJsonFile( join( this.stage, 'blueprint.json' ), atlas );
		this.started = performance.now();
		this.worker = new Worker( new URL( './streets-worker.js', import.meta.url ) );
		this.done = new Promise( ( resolve, reject ) => {

			this.worker.on( 'message', ( message ) => message.error
				? reject( new AssemblyError( 'E_STREETS_BUILD', message.error ) )
				: resolve( { stage: this.stage, reference: message.reference, ms: Math.round( performance.now() - this.started ) } ) );
			this.worker.on( 'error', ( error ) => reject( new AssemblyError( 'E_STREETS_BUILD', error.message ) ) );
			this.worker.on( 'exit', ( code ) => reject( new AssemblyError( 'E_STREETS_BUILD', `Streets worker exited (${code})` ) ) );

		} );
		this.worker.postMessage( { stage: this.stage, options } );

	}

	/** @returns the built streets directory and its blueprint-bound reference. */
	async prepared() {

		try {

			return await this.done;

		} finally { await this.worker.terminate(); }

	}

	dispose() { rmSync( this.stage, { recursive: true, force: true } ); }

}
