import { encodeBase64, sha256Hex } from './Canonical.js';
import { NpcVoiceError } from './NpcVoiceError.js';
import { VoiceBoundary } from './VoiceBoundary.js';

/** Browser port for the project-local Chatterbox Nano and faster-whisper process. */
export class LocalSpeechRuntime {

	static async connect( { endpoint = '/api/speech', fetchImpl = globalThis.fetch, boundary = new VoiceBoundary() } = {} ) {

		const capabilities = await requestJson( fetchImpl, `${endpoint}/capabilities` );
		boundary.input( 'runtime-capabilities', capabilities );
		return new LocalSpeechRuntime( { endpoint, fetchImpl, boundary, capabilities } );

	}

	constructor( { endpoint, fetchImpl, boundary, capabilities } ) {

		this.endpoint = endpoint;
		this.fetchImpl = fetchImpl;
		this.boundary = boundary;
		this.manifest = structuredClone( capabilities.tts );
		this.stt = structuredClone( capabilities.stt );

	}

	capabilities() {

		return structuredClone( this.manifest );

	}

	async *synthesize( request, signal ) {

		this.boundary.input( 'adapter-request', request );
		const payload = await requestJson( this.fetchImpl, `${this.endpoint}/synthesize`, {
			method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( request )
		} );
		this.boundary.input( 'adapter-chunk', payload.chunk );
		yield payload.chunk;

	}

	async transcribe( media, { requestId, language } = {} ) {

		const mediaType = media?.type?.split( ';', 1 )[ 0 ].trim().toLowerCase();
		if ( ! mediaType || ! this.stt.mediaTypes.includes( mediaType ) ) {

			throw new NpcVoiceError( 'E_VOICE_INPUT', `Microphone media type ${media?.type || 'unknown'} is unsupported` );

		}
		const requestedLanguage = language ?? 'auto';
		if ( ! this.stt.languages.includes( requestedLanguage ) ) {

			throw new NpcVoiceError( 'E_VOICE_INPUT', `Transcription language ${requestedLanguage} is unsupported` );

		}
		const bytes = new Uint8Array( await media.arrayBuffer() );
		const request = {
			version: '1', requestId: requestId ?? `stt-${crypto.randomUUID()}`,
			mediaType, byteSize: bytes.byteLength, sha256: await sha256Hex( bytes ),
			dataBase64: encodeBase64( bytes ),
			...( requestedLanguage === 'auto' ? {} : { language: requestedLanguage } )
		};
		this.boundary.input( 'transcription-request', request );
		const result = await requestJson( this.fetchImpl, `${this.endpoint}/transcribe`, {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( request )
		} );
		this.boundary.input( 'transcription-result', result );
		if ( result.requestId !== request.requestId ) throw new NpcVoiceError( 'E_VOICE_ORDER', 'Transcript belongs to another request' );
		return result;

	}

}

async function requestJson( fetchImpl, url, init ) {

	let response;
	try { response = await fetchImpl( url, init ); }
	catch ( error ) { throw new NpcVoiceError( 'E_VOICE_ADAPTER', error.message ); }
	let payload;
	try { payload = await response.json(); }
	catch { throw new NpcVoiceError( 'E_VOICE_ADAPTER', `Speech runtime returned ${response.status} without JSON` ); }
	if ( ! response.ok ) throw new NpcVoiceError( 'E_VOICE_ADAPTER', payload.error ?? `Speech runtime returned ${response.status}` );
	return payload;

}
