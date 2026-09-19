import { documentHash } from '../../data/WorldDocument.js';
import { readShell } from './KitGeometry.js';

/** The fake rooms behind a plan's glass, which a real interior replaces. */
const SCENIC = /\|scenic$/;

/**
 * One building plan's published files, checked against what the index says they
 * are and decoded into what the city draws that building with.
 *
 * A plan is one Exterior shell generated on a canonical lot, and every copy of
 * it in the city is drawn from these geometries. The length and the hash the
 * index publishes are what says the file on disk is the one the world was
 * assembled from, so a file that is missing, refuses to decode or differs from
 * them is `E_KIT_PIECES` and that plan never stands.
 */
export async function readPlan( entry, { baseUrl, factory, loader, readBinary, readJson } ) {

	const url = `${baseUrl}/${entry.glb}`;
	let blueprint;
	let scene;

	try {

		blueprint = await readJson( `${baseUrl}/${entry.blueprint}` );
		const bytes = await readBinary( url );
		if ( Number.isInteger( entry.bytes ) && bytes.byteLength !== entry.bytes ) {

			throw new Error( `${bytes.byteLength} bytes, the index publishes ${entry.bytes}` );

		}
		if ( entry.sha256 && await documentHash( bytes ) !== entry.sha256 ) throw new Error( 'byte hash mismatch' );
		( { scene } = await loader.parseAsync( bytes, `${baseUrl}/` ) );

	} catch ( cause ) {

		throw pieceError( url, cause );

	}

	const shell = readShell( scene, factory, blueprint );
	// The fake rooms behind the glass are their own entry: a parcel that opens a
	// real interior draws the plan without them.
	const surfaces = shell.surfaces.filter( ( { bucket } ) => ! SCENIC.test( bucket ) );
	const scenery = shell.surfaces.filter( ( { bucket } ) => SCENIC.test( bucket ) );
	const { leaves } = shell;

	return {
		id: entry.id, baysAcross: entry.baysAcross, baysDeep: entry.baysDeep,
		surfaces, scenery, leaves,
		triangles: [ ...surfaces, ...scenery ].reduce( ( sum, { geometry } ) => sum + triangles( geometry ), 0 )
			+ leaves.reduce( ( sum, leaf ) => sum + leaf.surfaces.reduce( ( part, { geometry } ) => part + triangles( geometry ), 0 ), 0 )
	};

}

export function pieceError( what, cause ) {

	return Object.assign( new Error( `E_KIT_PIECES: ${what}: ${cause.message ?? cause}` ), { code: 'E_KIT_PIECES', cause } );

}

function triangles( geometry ) {

	return ( geometry.getIndex()?.count ?? geometry.getAttribute( 'position' ).count ) / 3;

}
