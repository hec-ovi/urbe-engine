import * as dialog from '../../../quests/dist/runtime.js';
import { OpenAIPort } from './OpenAIPort.js';
import { closing, messageOf, readJson, sendJson } from './routeHttp.js';
import { TalkBoundary } from './TalkBoundary.js';
import { TalkService } from './TalkService.js';

const NDJSON = { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' };
/** The largest talk request body: the person, what they do, the line and the quests as they stand. */
const TALK_BYTES = 256 * 1024;
/** The largest memory a save hands back; the server keeps a bounded part of it. */
const MEMORY_BYTES = 32 * 1024 * 1024;

/**
 * Vite plugin for NPC dialogue. POST /api/talk/stream answers with one JSON
 * event per line as the reply is spoken, after checking the browser's
 * dialogue snapshot; the model server comes from the LLM_* environment
 * (OpenAIPort.fromEnv). GET /api/talk/memory reads what people remember in
 * one world, or one person, and PUT hands it the save's at load.
 */
export function talkRoute( outRoot, providedService = null ) {

	let service = providedService;
	const boundary = new TalkBoundary();
	const talk = () => service ??= new TalkService( OpenAIPort.fromEnv(), outRoot );
	const routes = { 'POST /stream': stream, 'GET /memory': memory, 'PUT /memory': restoreMemory, 'GET /abilities': abilities };

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

	/**
	 * 200 with what the loaded Quests build can talk about beyond the tools
	 * every build has, `{ abilities }` (Quests `DIALOG_ABILITIES`, none for a
	 * build without them), so a page asks before it sends anything new.
	 */
	async function abilities( req, res ) {

		sendJson( res, 200, { abilities: dialogAbilities() } );

	}

	/** 200 with the world's memory, or one person's, as `{ out, memory }`. */
	async function memory( req, res ) {

		const query = new URL( req.url, 'http://talk' ).searchParams;
		let out;
		try {

			out = boundary.out( query.get( 'out' ) );

		} catch ( error ) {

			return sendJson( res, 400, boundary.error( { error: messageOf( error ) } ) );

		}
		try {

			sendJson( res, 200, boundary.kept( { out, memory: await talk().memory( out, query.get( 'npcId' ) || null ) } ) );

		} catch ( error ) {

			sendJson( res, 502, boundary.error( { error: messageOf( error ) } ) );

		}

	}

	/** 204 once the world has joined the memory sent to its own. */
	async function restoreMemory( req, res ) {

		const request = await admit( req, res, 'talk memory', MEMORY_BYTES, ( value ) => boundary.memory( value ) );
		if ( ! request ) return;
		try {

			await talk().restoreMemory( request.out, request.memory );
			res.statusCode = 204;
			res.end();

		} catch ( error ) {

			sendJson( res, 502, boundary.error( { error: messageOf( error ) } ) );

		}

	}

	/** Answers 200 with the first event; a failure before it is a 502, after it an `error` event. */
	async function stream( req, res ) {

		const request = await admit( req, res, 'talk', TALK_BYTES, ( value ) => boundary.input( value ) );
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

	/** The request `check` passes, or null once a 400, or a 413 for a body over `limit`, has been sent. */
	async function admit( req, res, what, limit, check ) {

		try {

			return check( await readJson( req, what, limit ) );

		} catch ( error ) {

			sendJson( res, error.status ?? 400, boundary.error( { error: messageOf( error ) } ) );
			return null;

		}

	}

	function logUsage() {

		if ( service.llm?.usage ) console.info( 'talk tokens', service.llm.usage );

	}

}

/** The abilities of the Quests build this server loaded: `DIALOG_ABILITIES`, or none for a build that has no such list. */
export function dialogAbilities( runtime = dialog ) {

	const abilities = runtime?.DIALOG_ABILITIES;
	return Array.isArray( abilities ) ? abilities.filter( ( ability ) => typeof ability === 'string' ) : [];

}
