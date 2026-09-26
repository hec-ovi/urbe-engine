import { OpenAIPort } from './OpenAIPort.js';
import { TalkBoundary } from './TalkBoundary.js';
import { TalkService } from './TalkService.js';

const NDJSON = { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' };

/**
 * Vite plugin for NPC dialogue. POST /api/talk answers with the NPC's whole
 * reply, POST /api/talk/stream with one JSON event per line as the reply is
 * spoken. Both check the browser's dialogue snapshot first; the model server
 * comes from the LLM_* environment (OpenAIPort.fromEnv).
 */
export function talkRoute( outRoot, providedService = null ) {

	let service = providedService;
	const boundary = new TalkBoundary();
	const talk = () => service ??= new TalkService( OpenAIPort.fromEnv(), outRoot );
	const routes = { '/': reply, '/stream': stream };

	return {
		name: 'talk-route',
		configureServer( server ) {

			server.middlewares.use( '/api/talk', ( req, res, next ) => {

				const route = req.method === 'POST' && routes[ new URL( req.url, 'http://talk' ).pathname ];
				if ( ! route ) return next();
				route( req, res ).catch( next );

			} );

		}
	};

	async function reply( req, res ) {

		const request = await admit( req, res );
		if ( ! request ) return;
		try {

			const text = await talk().reply( request, { signal: closing( res ) } );
			logUsage();
			send( res, 200, boundary.output( { reply: text } ) );

		} catch ( error ) {

			send( res, 502, boundary.error( { error: messageOf( error ) } ) );

		}

	}

	/** Answers 200 with the first event; a failure before it is a 502, after it an `error` event. */
	async function stream( req, res ) {

		const request = await admit( req, res );
		if ( ! request ) return;
		try {

			for await ( const event of talk().stream( request, { signal: closing( res ) } ) ) {

				const line = `${JSON.stringify( boundary.event( event ) )}\n`;
				if ( ! res.headersSent ) res.writeHead( 200, NDJSON );
				res.write( line );

			}
			logUsage();
			res.end();

		} catch ( error ) {

			const failure = boundary.error( { error: messageOf( error ) } );
			if ( res.headersSent ) res.end( `${JSON.stringify( boundary.event( { type: 'error', ...failure } ) )}\n` );
			else send( res, 502, failure );

		}

	}

	/** The checked request, or null once a 400 has been sent. */
	async function admit( req, res ) {

		try {

			return boundary.input( parseRequestJson( await body( req ) ) );

		} catch ( error ) {

			send( res, 400, boundary.error( { error: messageOf( error ) } ) );
			return null;

		}

	}

	function logUsage() {

		if ( service.llm?.usage ) console.info( 'talk tokens', service.llm.usage );

	}

}

/** Aborts when the browser goes away before the answer is complete. */
function closing( res ) {

	const controller = new AbortController();
	res.on( 'close', () => res.writableFinished || controller.abort() );
	return controller.signal;

}

function parseRequestJson( text ) {

	try { return JSON.parse( text ); }
	catch ( cause ) {

		const error = new Error( `talk request is not valid JSON: ${messageOf( cause )}` );
		error.code = 'E_TALK_REQUEST_JSON';
		throw error;

	}

}

function messageOf( error ) {

	return error instanceof Error && error.message ? error.message : String( error ) || 'talk service failed';

}

function body( req ) {

	return new Promise( ( resolve, reject ) => {

		let text = '';
		req.setEncoding( 'utf8' );
		req.on( 'data', ( chunk ) => text += chunk );
		req.on( 'end', () => resolve( text ) );
		req.on( 'error', reject );

	} );

}

function send( res, status, payload ) {

	res.statusCode = status;
	res.setHeader( 'Content-Type', 'application/json' );
	res.end( JSON.stringify( payload ) );

}
