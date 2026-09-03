import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RUNTIME = fileURLToPath( new URL( '../game/voice/runtime', import.meta.url ) );
const PYTHON = fileURLToPath( new URL( '../game/voice/runtime/.venv/bin/python', import.meta.url ) );
const SERVICE = fileURLToPath( new URL( '../game/voice/runtime/service.py', import.meta.url ) );

/** Persistent newline-JSON port to the project-local Python model process. */
export class SpeechRuntimeProcess {

	constructor( {
		command = process.env.URBE_SPEECH_PYTHON ?? PYTHON,
		args = [ SERVICE, 'serve' ],
		env = process.env,
		spawnProcess = spawn
	} = {} ) {

		this.command = command;
		this.args = args;
		this.env = env;
		this.spawnProcess = spawnProcess;
		this.child = null;
		this.pending = new Map();
		this.nextId = 1;
		this.buffer = '';

	}

	request( operation, payload = {}, signal = null ) {

		if ( signal?.aborted ) return Promise.reject( abortError() );
		this.#open();
		const id = this.nextId ++;
		return new Promise( ( resolve, reject ) => {

			const cancel = () => {

				reject( abortError() );
				this.pending.delete( id );
				this.#stop( new Error( 'speech inference cancelled' ) );

			};
			signal?.addEventListener( 'abort', cancel, { once: true } );
			this.pending.set( id, {
				resolve: ( value ) => { signal?.removeEventListener( 'abort', cancel ); resolve( value ); },
				reject: ( error ) => { signal?.removeEventListener( 'abort', cancel ); reject( error ); }
			} );
			this.child.stdin.write( `${JSON.stringify( { id, operation, ...payload } )}\n` );

		} );

	}

	dispose() {

		this.#stop( new Error( 'speech runtime disposed' ) );

	}

	#open() {

		if ( this.child ) return;
		const child = this.spawnProcess( this.command, this.args, {
			cwd: RUNTIME, env: this.env, stdio: [ 'pipe', 'pipe', 'pipe' ]
		} );
		this.child = child;
		this.buffer = '';
		child.stdout.setEncoding( 'utf8' );
		child.stdout.on( 'data', ( chunk ) => this.#read( chunk ) );
		child.stderr.setEncoding( 'utf8' );
		child.stderr.on( 'data', ( chunk ) => process.stderr.write( `[speech] ${chunk}` ) );
		child.on( 'error', ( error ) => this.#stop( error, child ) );
		child.on( 'exit', ( code, signal ) => this.#stop(
			new Error( `speech runtime exited (${signal ?? code})` ), child
		) );

	}

	#read( chunk ) {

		this.buffer += chunk;
		while ( this.buffer.includes( '\n' ) ) {

			const split = this.buffer.indexOf( '\n' );
			const line = this.buffer.slice( 0, split );
			this.buffer = this.buffer.slice( split + 1 );
			if ( ! line ) continue;
			let response;
			try { response = JSON.parse( line ); }
			catch { this.#stop( new Error( 'speech runtime wrote malformed JSON' ) ); return; }
			const pending = this.pending.get( response.id );
			if ( ! pending ) continue;
			this.pending.delete( response.id );
			if ( response.ok ) pending.resolve( response.result );
			else pending.reject( new Error( response.error || 'speech runtime failed' ) );

		}

	}

	#stop( error, expected = this.child ) {

		if ( expected !== this.child ) return;
		const child = this.child;
		this.child = null;
		if ( child && child.exitCode === null && child.signalCode === null ) child.kill();
		for ( const pending of this.pending.values() ) pending.reject( error );
		this.pending.clear();

	}

}

function abortError() {

	const error = new Error( 'speech request cancelled' );
	error.name = 'AbortError';
	return error;

}
