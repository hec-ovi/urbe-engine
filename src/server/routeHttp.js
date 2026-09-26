/** Request and response pieces the development routes share. */

/** A request body the route refuses before it reads it as a request: not JSON (400) or over its size (413). */
export class BodyError extends Error {

	constructor( status, message ) {

		super( message );
		this.status = status;
		this.code = 'E_INVALID_REQUEST';

	}

}

/**
 * The request body parsed as JSON; `what` names the route in the error. A
 * body over `limit` bytes is refused without reading the rest into memory.
 * @throws BodyError
 */
export async function readJson( req, what, limit ) {

	const text = await new Promise( ( resolve, reject ) => {

		let size = 0;
		const chunks = [];
		req.on( 'data', ( chunk ) => {

			if ( size > limit ) return;
			size += chunk.length;
			if ( size <= limit ) {

				chunks.push( chunk );
				return;

			}
			// The rest is read and dropped, so the refusal still reaches the client.
			chunks.length = 0;
			reject( new BodyError( 413, `${what} request is over ${limit} bytes` ) );

		} );
		req.on( 'end', () => resolve( Buffer.concat( chunks ).toString( 'utf8' ) ) );
		req.on( 'error', reject );

	} );
	try { return JSON.parse( text ); }
	catch ( cause ) { throw new BodyError( 400, `${what} request is not valid JSON: ${messageOf( cause )}` ); }

}

export function sendJson( res, status, payload ) {

	res.statusCode = status;
	res.setHeader( 'Content-Type', 'application/json' );
	res.setHeader( 'Cache-Control', 'no-store' );
	res.end( JSON.stringify( payload ) );

}

/** A signal that aborts when the browser goes away before the answer is complete. */
export function closing( res ) {

	const controller = new AbortController();
	res.on( 'close', () => res.writableFinished || controller.abort() );
	return controller.signal;

}

export function messageOf( error, fallback = 'the service failed' ) {

	return error instanceof Error && error.message ? error.message : String( error ?? '' ) || fallback;

}
