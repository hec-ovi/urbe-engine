import { BuildingBuildService } from './BuildingBuildService.js';
import { exteriorRoute } from './exteriorRoute.js';
import { readJson, sendJson } from './routeHttp.js';

/** The largest building request body: a parcel, an out path and an optional Exterior request. */
const MAX_BYTES = 1024 * 1024;

/** POST /api/building ensures that one selected Atlas parcel has the requested preview source. */
export function buildingRoute( engineRoot, atlasDir, service = null ) {

	return {
		name: 'building-build-route',
		configureServer( server ) {

			server.middlewares.use( '/api/exteriors', exteriorRoute( engineRoot ) );

			server.middlewares.use( '/api/building', async ( req, res, next ) => {

				if ( req.method !== 'POST' ) return next();
				service ??= new BuildingBuildService( { engineRoot, atlasDir } );

				try {

					sendJson( res, 200, await service.ensure( await readJson( req, 'building', MAX_BYTES ) ) );

				} catch ( error ) {

					sendJson( res, error.status ?? 500, { code: error.code ?? 'E_BUILD_FAILED', message: error.message } );

				}

			} );

		}
	};

}
