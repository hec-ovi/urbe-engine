/** Request and response pieces the dialogue and voice routes share. */

/** The request body parsed as JSON; `what` names the route in the error. */
export async function readJson( req, what ) {

	const text = await new Promise( ( resolve, reject ) => {

		let body = '';
		req.setEncoding( 'utf8' );
		req.on( 'data', ( chunk ) => body += chunk );
		req.on( 'end', () => resolve( body ) );
		req.on( 'error', reject );

	} );
	try { return JSON.parse( text ); }
	catch ( cause ) { throw new Error( `${what} request is not valid JSON: ${messageOf( cause )}` ); }

}

export function sendJson( res, status, payload ) {

	res.statusCode = status;
	res.setHeader( 'Content-Type', 'application/json' );
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
