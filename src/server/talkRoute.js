import { OpenAIPort } from './OpenAIPort.js';
import { TalkService } from './TalkService.js';

const DEFAULT_BASE_URL = 'http://localhost:8080/v1';

/**
 * Vite plugin: POST /api/talk { out, npc, behavior, line, timeMin } answers
 * { reply } with the NPC's words, or { error } with 502 when the model server
 * is unreachable. The model server comes from LLM_BASE_URL and LLM_MODEL.
 */
export function talkRoute( outRoot ) {

	let service = null;

	return {
		name: 'talk-route',
		configureServer( server ) {

			server.middlewares.use( '/api/talk', async ( req, res, next ) => {

				if ( req.method !== 'POST' ) return next();
				service ??= new TalkService( new OpenAIPort( process.env.LLM_BASE_URL ?? DEFAULT_BASE_URL, process.env.LLM_MODEL ?? null ), outRoot );

				try {

					const reply = await service.reply( JSON.parse( await body( req ) ) );
					send( res, 200, { reply } );

				} catch ( error ) {

					send( res, 502, { error: error.message } );

				}

			} );

		}
	};

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
