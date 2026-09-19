import { documentHash } from '../../data/WorldDocument.js';
import { readShell } from './KitGeometry.js';

/** The fake rooms behind a plan's glass, which a real interior replaces. */
const SCENIC = /\|scenic$/;

/**
 * One building plan's published files, read and checked against what the index
 * says they are.
 *
 * Reading is the only part of standing a plan that is not work for the main
 * thread, so it is kept apart: a stream that opens a cell ahead of the one it
 * is building reads here, and decodes only when that cell's turn comes.
 *
 * The length and the hash the index publishes are what says the file on disk is
 * the one the world was assembled from, so a file that is missing or differs
 * from them is `E_KIT_PIECES` and that plan never stands. The blueprint comes
 * from the city's shared [plan blueprints](../../data/PlanBlueprints.js), which
 * is the same document every parcel of this plan composes its own from.
 */
export async function readPlanFile( entry, { baseUrl, readBinary, blueprints } ) {

	const url = `${baseUrl}/${entry.glb}`;

	try {

		const blueprint = await blueprints.of( entry.id );
		const bytes = await readBinary( url );
		if ( Number.isInteger( entry.bytes ) && bytes.byteLength !== entry.bytes ) {

			throw new Error( `${bytes.byteLength} bytes, the index publishes ${entry.bytes}` );

		}
		if ( entry.sha256 && await documentHash( bytes ) !== entry.sha256 ) throw new Error( 'byte hash mismatch' );

		return { bytes, blueprint };

	} catch ( cause ) {

		throw pieceError( url, cause );

	}

}

/**
 * That file decoded into what the city draws this building with: its surfaces,
 * the fake rooms behind its glass and its entrance leaves, in the plan's own
 * frame. A file that refuses to decode is `E_KIT_PIECES` like one that never
 * arrived.
 */
export async function decodePlan( entry, { bytes, blueprint }, { baseUrl, factory, loader } ) {

	let scene;

	try {

		( { scene } = await loader.parseAsync( bytes, `${baseUrl}/` ) );

	} catch ( cause ) {

		throw pieceError( `${baseUrl}/${entry.glb}`, cause );

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
