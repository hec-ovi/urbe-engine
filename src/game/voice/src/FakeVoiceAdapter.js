import { canonicalJson, cloneJson, encodeBase64, sha256Hex } from './Canonical.js';
import { VoiceBoundary } from './VoiceBoundary.js';

export class FakeVoiceAdapter {

	#boundary;
	#manifest;
	#delayMs;
	#active = 0;
	#startWaiters = new Map();

	constructor( { manifest, delayMs = 0, boundary = new VoiceBoundary() } ) {

		this.#boundary = boundary;
		this.#boundary.input( 'capability-manifest', manifest );
		this.#manifest = cloneJson( manifest );
		this.#delayMs = delayMs;
		this.trace = { started: [], completed: [], cancelled: [], maxObservedConcurrent: 0 };

	}

	capabilities() {

		return cloneJson( this.#manifest );

	}

	async *synthesize( request, signal ) {

		this.#boundary.input( 'adapter-request', request );
		throwIfAborted( signal );
		this.#active ++;
		this.trace.maxObservedConcurrent = Math.max( this.trace.maxObservedConcurrent, this.#active );
		this.trace.started.push( request.requestId );
		this.#startWaiters.get( request.requestId )?.();
		this.#startWaiters.delete( request.requestId );

		try {

			const digest = await sha256Hex( canonicalJson( {
				profileDigest: request.profileRecord.profileDigest,
				segmentIndex: request.segmentIndex,
				spans: request.spans,
				delivery: request.delivery,
				inference: request.inference,
				output: request.output
			} ) );
			const frameCount = Math.max( 16, Math.ceil( canonicalJson( request.spans ).length / 2 ) );
			const split = frameCount > 16 ? [ Math.floor( frameCount / 2 ), Math.ceil( frameCount / 2 ) ] : [ frameCount ];

			for ( let sequence = 0; sequence < split.length; sequence ++ ) {

				await cancellableDelay( this.#delayMs, signal );
				const frames = split[ sequence ];
				const byteSize = request.output.codec === 'pcm_s16le'
					? frames * request.output.channels * 2
					: Math.max( 1, frames );
				const bytes = deterministicBytes( digest, sequence, byteSize );
				const chunk = {
					version: '1',
					requestId: request.requestId,
					segmentIndex: request.segmentIndex,
					sequence,
					sampleRate: request.output.sampleRate,
					channels: request.output.channels,
					codec: request.output.codec,
					frameCount: frames,
					byteSize,
					sha256: await sha256Hex( bytes ),
					dataBase64: encodeBase64( bytes ),
					spanIndex: request.spans[ 0 ].spanIndex
				};
				this.#boundary.output( 'adapter-chunk', chunk );
				yield chunk;

			}
			this.trace.completed.push( request.requestId );

		} catch ( error ) {

			if ( error?.name === 'AbortError' ) this.trace.cancelled.push( request.requestId );
			throw error;

		} finally {

			this.#active --;

		}

	}

	waitForStart( requestId ) {

		if ( this.trace.started.includes( requestId ) ) return Promise.resolve();
		return new Promise( ( resolve ) => this.#startWaiters.set( requestId, resolve ) );

	}

}

function deterministicBytes( digest, sequence, byteSize ) {

	const source = new Uint8Array( digest.match( /../g ).map( ( pair ) => Number.parseInt( pair, 16 ) ) );
	const bytes = new Uint8Array( byteSize );
	for ( let index = 0; index < bytes.length; index ++ ) {

		bytes[ index ] = source[ ( index + sequence * 7 ) % source.length ] ^ ( sequence & 0xff );

	}
	return bytes;

}

function throwIfAborted( signal ) {

	if ( signal?.aborted ) throw abortError();

}

function cancellableDelay( delayMs, signal ) {

	throwIfAborted( signal );
	return new Promise( ( resolve, reject ) => {

		const timer = setTimeout( finish, delayMs );
		function finish() {

			signal?.removeEventListener( 'abort', cancel );
			resolve();

		}
		function cancel() {

			clearTimeout( timer );
			reject( abortError() );

		}
		signal?.addEventListener( 'abort', cancel, { once: true } );

	} );

}

function abortError() {

	const error = new Error( 'NPC voice request cancelled' );
	error.name = 'AbortError';
	return error;

}
