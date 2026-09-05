import { ExteriorBuildService } from './ExteriorBuildService.js';
import { ExteriorBuildError } from './ExteriorBuildBoundary.js';

export function exteriorRoute( engineRoot, service = null, maxRequestBytes = 128 * 1024 * 1024 ) {

	return async ( req, res, next ) => {

		const path = new URL( req.url, 'http://localhost' ).pathname.replace( /^\/api\/exteriors/, '' );
		if ( ! [ 'GET', 'POST' ].includes( req.method ) ) return next();
		try {

			service ??= new ExteriorBuildService( { engineRoot } );

			if ( req.method === 'GET' && ( path === '' || path === '/' ) ) return send( res, 200, service.capability() );
			if ( req.method === 'GET' && /^\/[A-Za-z0-9_-]+$/.test( path ) ) return send( res, 200, service.get( path.slice( 1 ) ) );
			if ( req.method === 'POST' && ( path === '' || path === '/' ) ) {

				return send( res, 202, service.start( JSON.parse( await readBody( req, maxRequestBytes ) ) ) );

			}
			return next();

		} catch ( error ) {

			const malformed = error instanceof SyntaxError;
			send( res, malformed ? 400 : error.status ?? 500, { code: malformed ? 'E_INVALID_REQUEST' : error.code ?? 'E_STORAGE', message: malformed ? 'request body is not valid JSON' : error.message } );

		}

	};

}

function readBody( req, limit ) {

	return new Promise( ( resolve, reject ) => {

		let size = 0;
		const chunks = [];
		req.on( 'data', ( chunk ) => {

			size += chunk.length;
			if ( size > limit ) { chunks.length = 0; reject( new ExteriorBuildError( 'E_INVALID_REQUEST', 'blueprint request exceeds the upload limit', 413 ) ); }
			else chunks.push( chunk );

		} );
		req.on( 'end', () => resolve( Buffer.concat( chunks ).toString( 'utf8' ) ) );
		req.on( 'error', reject );

	} );

}

function send( res, status, value ) {

	res.statusCode = status;
	res.setHeader( 'Content-Type', 'application/json' );
	res.setHeader( 'Cache-Control', 'no-store' );
	res.end( JSON.stringify( value ) );

}
