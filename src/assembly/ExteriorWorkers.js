import { Worker } from 'node:worker_threads';
import { AssemblyError } from './RequestAssembler.js';

/** Persistent producer workers amortize module startup across city shells. */
export class ExteriorWorkers {
	constructor( size = 4 ) {
		if ( ! Number.isInteger( size ) || size < 1 ) throw new AssemblyError( 'E_REQUEST_INVALID', 'Exterior worker count must be positive' );
		this.queue = [];
		this.sequence = 0;
		this.closed = false;
		this.slots = Array.from( { length: size }, () => {
			const slot = { worker: new Worker( new URL( './exterior-worker.js', import.meta.url ) ), job: null };
			slot.worker.on( 'message', message => this.complete( slot, message ) );
			slot.worker.on( 'error', error => this.fail( error ) );
			slot.worker.on( 'exit', code => { if ( ! this.closed ) this.fail( new Error( `Exterior worker exited (${code})` ) ); } );
			return slot;
		} );
	}

	run( request, outDir ) {
		if ( this.closed ) return Promise.reject( new AssemblyError( 'E_EXTERIOR_FAILED', 'Exterior workers are closed' ) );
		return new Promise( ( resolve, reject ) => {
			this.queue.push( { id: this.sequence ++, request, outDir, resolve, reject } );
			this.dispatch();
		} );
	}

	async close() {
		this.closed = true;
		this.reject( new AssemblyError( 'E_EXTERIOR_FAILED', 'Exterior workers closed before completion' ) );
		await Promise.all( this.slots.map( slot => slot.worker.terminate() ) );
	}

	dispatch() {
		for ( const slot of this.slots ) {
			if ( slot.job || ! this.queue.length ) continue;
			const job = this.queue.shift();
			slot.job = job;
			slot.worker.postMessage( { id: job.id, request: job.request, outDir: job.outDir } );
		}
	}

	complete( slot, message ) {
		const job = slot.job;
		if ( ! job || message.id !== job.id ) { this.fail( new Error( 'Exterior worker response identity differs' ) ); return; }
		slot.job = null;
		if ( message.error ) job.reject( new AssemblyError( 'E_EXTERIOR_FAILED', message.error ) );
		else job.resolve( message.blueprint );
		if ( ! this.closed ) this.dispatch();
	}

	reject( error ) {
		for ( const job of this.queue.splice( 0 ) ) job.reject( error );
		for ( const slot of this.slots ) {
			slot.job?.reject( error );
			slot.job = null;
		}
	}

	fail( error ) {
		if ( this.closed ) return;
		this.reject( new AssemblyError( 'E_EXTERIOR_FAILED', error.message ) );
		void this.close();
	}
}
