import { BuildingBuildService } from './BuildingBuildService.js';

/** POST /api/building ensures that one selected Atlas parcel has an exterior preview. */
export function buildingRoute( engineRoot, atlasDir, service = null ) {

	return {
		name: 'building-build-route',
		configureServer( server ) {

			server.middlewares.use( '/api/building', async ( req, res, next ) => {

				if ( req.method !== 'POST' ) return next();
				service ??= new BuildingBuildService( { engineRoot, atlasDir } );

				try {

					const result = await service.ensure( JSON.parse( await body( req ) ) );
					send( res, 200, result );

				} catch ( error ) {

					const malformed = error instanceof SyntaxError;
					send( res, malformed ? 400 : error.status ?? 500, {
						code: malformed ? 'E_INVALID_REQUEST' : error.code ?? 'E_BUILD_FAILED',
						message: malformed ? 'request body is not valid JSON' : error.message
					} );

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
