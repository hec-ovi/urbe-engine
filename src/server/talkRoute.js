import { OpenAIPort } from './OpenAIPort.js';
import { TalkBoundary } from './TalkBoundary.js';
import { TalkService } from './TalkService.js';

const DEFAULT_BASE_URL = 'http://localhost:8080/v1';

/**
 * Vite plugin: POST /api/talk validates the browser dialogue snapshot and
 * answers with the NPC's words. The model server comes from LLM_BASE_URL and
 * LLM_MODEL.
 */
export function talkRoute( outRoot, providedService = null ) {

	let service = providedService;
	const boundary = new TalkBoundary();

	return {
		name: 'talk-route',
		configureServer( server ) {

			server.middlewares.use( '/api/talk', async ( req, res, next ) => {

				if ( req.method !== 'POST' ) return next();
				try {

					const request = boundary.input( parseRequestJson( await body( req ) ) );
					service ??= new TalkService(
						new OpenAIPort( process.env.LLM_BASE_URL ?? DEFAULT_BASE_URL, process.env.LLM_MODEL || null ), outRoot
					);
					const reply = await service.reply( request );
					send( res, 200, boundary.output( { reply } ) );

				} catch ( error ) {

					const invalid = error?.code === 'E_TALK_REQUEST_JSON' || error?.code === 'E_TALK_INPUT';
					send( res, invalid ? 400 : 502, boundary.error( { error: messageOf( error ) } ) );

				}

			} );

		}
	};

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
