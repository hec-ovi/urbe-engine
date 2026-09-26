import { OpenAIPort } from './OpenAIPort.js';
import { closing, messageOf, readJson, sendJson } from './routeHttp.js';
import { TalkBoundary } from './TalkBoundary.js';
import { TalkService } from './TalkService.js';

const NDJSON = { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' };

/**
 * Vite plugin for NPC dialogue. POST /api/talk answers with the NPC's whole
 * reply, POST /api/talk/stream with one JSON event per line as the reply is
 * spoken. Both check the browser's dialogue snapshot first; the model server
 * comes from the LLM_* environment (OpenAIPort.fromEnv). GET and PUT
 * /api/talk/memory read and replace what people remember in one world, for
 * the game save.
 */
export function talkRoute( outRoot, providedService = null ) {

	let service = providedService;
	const boundary = new TalkBoundary();
	const talk = () => service ??= new TalkService( OpenAIPort.fromEnv(), outRoot );
	const routes = { 'POST /': reply, 'POST /stream': stream, 'GET /memory': memory, 'PUT /memory': restoreMemory };

	return {
		name: 'talk-route',
		configureServer( server ) {

			server.middlewares.use( '/api/talk', ( req, res, next ) => {

				const route = routes[ `${req.method} ${new URL( req.url, 'http://talk' ).pathname}` ];
				if ( ! route ) return next();
				route( req, res ).catch( next );

			} );

		}
	};

	/** 200 with the world's memory, as `{ out, memory }`. */
	async function memory( req, res ) {

		let out;
		try {

			out = boundary.out( new URL( req.url, 'http://talk' ).searchParams.get( 'out' ) );

		} catch ( error ) {

			return sendJson( res, 400, boundary.error( { error: messageOf( error ) } ) );

		}
		try {

			sendJson( res, 200, boundary.memory( { out, memory: await talk().memory( out ) }, 'E_TALK_OUTPUT' ) );

		} catch ( error ) {

			sendJson( res, 502, boundary.error( { error: messageOf( error ) } ) );

		}

	}

	/** 204 once the world's memory is the one sent. */
	async function restoreMemory( req, res ) {

		let request;
		try {

			request = boundary.memory( await readJson( req, 'talk memory' ) );

		} catch ( error ) {

			return sendJson( res, 400, boundary.error( { error: messageOf( error ) } ) );

		}
		try {

			await talk().restoreMemory( request.out, request.memory );
			res.statusCode = 204;
			res.end();

		} catch ( error ) {

			sendJson( res, 502, boundary.error( { error: messageOf( error ) } ) );

		}

	}

	async function reply( req, res ) {

		const request = await admit( req, res );
		if ( ! request ) return;
		try {

			const text = await talk().reply( request, { signal: closing( res ) } );
			logUsage();
			sendJson( res, 200, boundary.output( { reply: text } ) );

		} catch ( error ) {

			sendJson( res, 502, boundary.error( { error: messageOf( error ) } ) );

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
			else sendJson( res, 502, failure );

		}

	}

	/** The checked request, or null once a 400 has been sent. */
	async function admit( req, res ) {

		try {

			return boundary.input( await readJson( req, 'talk' ) );

		} catch ( error ) {

			sendJson( res, 400, boundary.error( { error: messageOf( error ) } ) );
			return null;

		}

	}

	function logUsage() {

		if ( service.llm?.usage ) console.info( 'talk tokens', service.llm.usage );

	}

}
