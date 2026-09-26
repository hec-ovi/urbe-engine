import { ExteriorBuildService } from './ExteriorBuildService.js';
import { readJson, sendJson } from './routeHttp.js';

export function exteriorRoute( engineRoot, service = null, maxRequestBytes = 128 * 1024 * 1024 ) {

	return async ( req, res, next ) => {

		const path = new URL( req.url, 'http://localhost' ).pathname.replace( /^\/api\/exteriors/, '' );
		if ( ! [ 'GET', 'POST' ].includes( req.method ) ) return next();
		try {

			service ??= new ExteriorBuildService( { engineRoot } );

			if ( req.method === 'GET' && ( path === '' || path === '/' ) ) return sendJson( res, 200, service.capability() );
			if ( req.method === 'GET' && /^\/[A-Za-z0-9_-]+$/.test( path ) ) return sendJson( res, 200, service.get( path.slice( 1 ) ) );
			if ( req.method === 'POST' && ( path === '' || path === '/' ) ) {

				return sendJson( res, 202, service.start( await readJson( req, 'blueprint', maxRequestBytes ) ) );

			}
			return next();

		} catch ( error ) {

			sendJson( res, error.status ?? 500, { code: error.code ?? 'E_STORAGE', message: error.message } );

		}

	};

}
