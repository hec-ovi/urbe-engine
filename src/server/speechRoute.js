import { SpeechRuntimeProcess } from './SpeechRuntimeProcess.js';
import { SpeechRuntimeHttp } from './SpeechRuntimeHttp.js';
import { decodeBase64, sha256Hex } from '../game/voice/src/Canonical.js';
import { VoiceBoundary } from '../game/voice/src/VoiceBoundary.js';

const MAX_BODY_BYTES = 48 * 1024 * 1024;

/** Vite route for the verified project-local speech model process. */
export function speechRoute( runtime = defaultRuntime() ) {

	const boundary = new VoiceBoundary();

	return {
		name: 'speech-route',
		configureServer( server ) {

			server.middlewares.use( '/api/speech', async ( req, res, next ) => {

				const path = new URL( req.url, 'http://localhost' ).pathname.replace( /^\/api\/speech/, '' ) || '/';
				const operation = operations.get( `${req.method} ${path}` );
				if ( ! operation ) return next();
				const controller = new AbortController();
				req.on( 'aborted', () => controller.abort() );
				res.on( 'close', () => { if ( ! res.writableEnded ) controller.abort(); } );
				try {

					const request = req.method === 'POST' ? JSON.parse( await body( req ) ) : null;
					if ( operation === 'synthesize' ) boundary.input( 'adapter-request', request );
					if ( operation === 'transcribe' ) await validateTranscription( boundary, request );
					const payload = request ? { request } : {};
					const result = await runtime.request( operation, payload, controller.signal );
					if ( operation === 'capabilities' ) boundary.output( 'runtime-capabilities', result );
					if ( operation === 'synthesize' ) boundary.output( 'adapter-chunk', result.chunk );
					if ( operation === 'transcribe' ) boundary.output( 'transcription-result', result );
					send( res, 200, result );

				} catch ( error ) {

					send( res, error?.code === 'E_BODY_SIZE' ? 413 : 503, { error: error.message } );

				}

			} );
			server.httpServer?.once( 'close', () => runtime.dispose() );

		}
	};

}

function defaultRuntime() {

	return process.env.URBE_SPEECH_URL
		? new SpeechRuntimeHttp( process.env.URBE_SPEECH_URL )
		: new SpeechRuntimeProcess();

}

async function validateTranscription( boundary, request ) {

	boundary.input( 'transcription-request', request );
	const bytes = decodeBase64( request.dataBase64 );
	if ( bytes.byteLength !== request.byteSize ) throw new Error( 'microphone byteSize disagrees with decoded audio' );
	if ( await sha256Hex( bytes ) !== request.sha256 ) throw new Error( 'microphone SHA-256 disagrees with decoded audio' );

}

const operations = new Map( [
	[ 'GET /capabilities', 'capabilities' ],
	[ 'GET /health', 'health' ],
	[ 'POST /synthesize', 'synthesize' ],
	[ 'POST /transcribe', 'transcribe' ]
] );

function body( req ) {

	return new Promise( ( resolve, reject ) => {

		let text = '';
		req.setEncoding( 'utf8' );
		req.on( 'data', ( chunk ) => {

			text += chunk;
			if ( Buffer.byteLength( text ) <= MAX_BODY_BYTES ) return;
			const error = new Error( 'speech request body exceeds 48 MiB' );
			error.code = 'E_BODY_SIZE';
			reject( error );
			req.destroy();

		} );
		req.on( 'end', () => resolve( text ) );
		req.on( 'error', reject );

	} );

}

function send( res, status, payload ) {

	if ( res.writableEnded ) return;
	res.statusCode = status;
	res.setHeader( 'Content-Type', 'application/json' );
	res.setHeader( 'Cache-Control', 'no-store' );
	res.end( JSON.stringify( payload ) );

}
