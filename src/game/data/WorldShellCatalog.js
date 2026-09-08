import Ajv2020 from 'ajv/dist/2020.js';
import schema from '../../assembly/schema/shell-catalog.schema.json';

const ajv = new Ajv2020( { allErrors: true, strict: true } );
const validate = ajv.compile( schema );
const RESIDENT_RADIUS = 250;

/** Admits the source-derived shell catalog against the complete manifest. */
export async function loadShellCatalog( manifest, readDocument ) {

	if ( ! manifest.shellCatalog ) return null;
	try {

		const reference = manifest.shellCatalog;
		const { data } = await readDocument( reference.file, reference );
		if ( ! validate( data ) ) throw new Error( ajv.errorsText( validate.errors ) );
		if ( data.seed !== manifest.seed ) throw new Error( 'catalog seed differs from the manifest' );
		const ids = new Set( data.buildings.map( building => building.id ) );
		if ( ids.size !== data.buildings.length || ids.size !== manifest.parcels.length || manifest.parcels.some( id => ! ids.has( id ) ) ) {

			throw new Error( 'catalog IDs differ from the manifest shell IDs' );

		}
		for ( const building of data.buildings ) {

			if ( building.bounds.min.some( ( value, axis ) => value >= building.bounds.max[ axis ] ) ) {

				throw new Error( `${building.id} bounds must have positive extent` );

			}
			if ( building.bands.some( band => band.top <= band.bottom ) ) throw new Error( `${building.id} bands must have positive height` );

		}
		return data;

	} catch ( cause ) {

		throw Object.assign( new Error( `E_WORLD_SHELL_CATALOG: ${cause.message}; re-run assemble-city` ), { code: 'E_WORLD_SHELL_CATALOG', cause } );

	}

}

/** All interiors and nearby authored bounds form the initial large-city window. */
export function initialBuildingIds( catalog, manifest, game ) {

	if ( ! catalog || manifest.parcels.length <= 250 ) return manifest.parcels;
	const interiors = new Set( manifest.interiors );
	const point = initialPoint( catalog, manifest, game );
	const nearby = new Set( catalog.buildings.filter( building => {

		const { min, max } = building.bounds;
		const dx = Math.max( min[ 0 ] - point.x, 0, point.x - max[ 0 ] );
		const dz = Math.max( min[ 2 ] - point.z, 0, point.z - max[ 2 ] );
		return dx * dx + dz * dz <= RESIDENT_RADIUS * RESIDENT_RADIUS;

	} ).map( building => building.id ) );
	return manifest.parcels.filter( id => interiors.has( id ) || nearby.has( id ) );

}

function initialPoint( catalog, manifest, game ) {

	if ( game ) {

		const position = game.player?.position;
		if ( ! Number.isFinite( position?.x ) || ! Number.isFinite( position?.z ) ) {

			throw Object.assign( new Error( 'E_WORLD_BUILDINGS: saved game needs a finite player position' ), { code: 'E_WORLD_BUILDINGS' } );

		}
		return position;

	}
	const first = catalog.buildings.find( building => building.id === manifest.interiors[ 0 ] );
	if ( first ) return { x: first.center[ 0 ], z: first.center[ 2 ] };
	let minX = Infinity, minZ = Infinity, maxX = - Infinity, maxZ = - Infinity;
	for ( const { bounds } of catalog.buildings ) {

		minX = Math.min( minX, bounds.min[ 0 ] ); maxX = Math.max( maxX, bounds.max[ 0 ] );
		minZ = Math.min( minZ, bounds.min[ 2 ] ); maxZ = Math.max( maxZ, bounds.max[ 2 ] );

	}
	return { x: ( minX + maxX ) / 2, z: ( minZ + maxZ ) / 2 };

}
