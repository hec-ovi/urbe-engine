import { cloneJson } from './Canonical.js';
import { NpcVoiceError } from './NpcVoiceError.js';
import { VoiceBoundary } from './VoiceBoundary.js';

const terminal = new Set( [ 'completed', 'cancelled', 'failed' ] );

export class AudioWorkletPacketTransport {

	#boundary;
	#records = new Map();

	constructor( { boundary = new VoiceBoundary() } = {} ) {

		this.#boundary = boundary;

	}

	push( event ) {

		this.#boundary.input( 'lifecycle-event', event );
		const record = this.#record( event.requestId );
		if ( event.eventSequence !== record.events.length ) {

			throw new NpcVoiceError( 'E_VOICE_TRANSPORT', `Event ${event.eventSequence} is out of order` );

		}
		if ( event.type === 'chunk' && event.chunk.sequence !== record.chunks.length ) {

			throw new NpcVoiceError( 'E_VOICE_TRANSPORT', `Chunk ${event.chunk.sequence} is out of order` );

		}
		record.events.push( cloneJson( event ) );
		if ( event.type === 'chunk' ) record.chunks.push( cloneJson( event.chunk ) );
		if ( event.type === 'accepted' ) record.status = 'queued';
		if ( event.type === 'started' || event.type === 'cache-hit' ) record.status = 'active';
		if ( terminal.has( event.type ) ) record.status = event.type;

	}

	read( request ) {

		this.#boundary.input( 'playback-read', request );
		const record = this.#records.get( request.requestId );
		const chunks = ( record?.chunks ?? [] ).filter( ( chunk ) => chunk.sequence > request.afterSequence );
		const result = {
			version: '1',
			requestId: request.requestId,
			status: record?.status ?? 'unknown',
			complete: terminal.has( record?.status ),
			nextSequence: chunks.at( -1 )?.sequence ?? request.afterSequence,
			chunks: cloneJson( chunks )
		};
		this.#boundary.output( 'playback-batch', result );
		return result;

	}

	history( request ) {

		this.#boundary.input( 'wait-request', request );
		const result = {
			version: '1',
			requestId: request.requestId,
			events: cloneJson( this.#records.get( request.requestId )?.events ?? [] )
		};
		this.#boundary.output( 'event-history', result );
		return result;

	}

	#record( requestId ) {

		if ( ! this.#records.has( requestId ) ) {

			this.#records.set( requestId, { status: 'unknown', events: [], chunks: [] } );

		}
		return this.#records.get( requestId );

	}

}
