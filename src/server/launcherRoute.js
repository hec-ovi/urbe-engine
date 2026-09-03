import { LibraryError } from '../library/index.js';
import { CreationError } from '../creation/index.js';
import { LauncherService, LauncherServiceError } from './LauncherService.js';

const METHODS = new Set( [
	'catalog', 'continueGame', 'exportGame', 'importGame', 'exportCity',
	'generateCity', 'generateInstances', 'generateQuests', 'createGame', 'saveCurrent'
] );

/** POST /api/launcher invokes one closed launcher service operation. */
export function launcherRoute( engineRoot, creation = null, service = null ) {

	return {
		name: 'launcher-route',
		configureServer( server ) {

			server.middlewares.use( '/api/launcher', async ( req, res, next ) => {

				if ( req.method !== 'POST' ) return next();
				service ??= new LauncherService( { outDir: `${engineRoot}/out`, creation } );

				try {

					const request = JSON.parse( await readBody( req ) );
					if ( ! request || typeof request !== 'object' || ! METHODS.has( request.method ) ) {

						throw new LauncherServiceError( 'E_INVALID_REQUEST', 'unknown launcher method' );

					}
					const input = request.input;
					const result = request.method === 'catalog'
						? await service.catalog()
						: await service[ request.method ]( input );
					send( res, 200, result );

				} catch ( error ) {

					const malformed = error instanceof SyntaxError;
					const known = error instanceof LibraryError || error instanceof LauncherServiceError || error instanceof CreationError;
					send( res, malformed ? 400 : known ? error.status ?? 400 : 500, {
						code: malformed ? 'E_INVALID_REQUEST' : error.code ?? 'E_LAUNCHER',
						message: malformed ? 'request body is not valid JSON' : error.message
					} );

				}

			} );

		}
	};

}

function readBody( req ) {

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
