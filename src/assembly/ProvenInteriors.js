import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { blueprintFile, placementsFile } from './kit/KitFiles.js';
import proven from './proven-interiors.json' with { type: 'json' };

/** Each design whose furnished interior was reviewed in pairs, and why it is trusted. */
export const PROVEN_DESIGNS = new Map( Object.entries( proven.designs ) );

/**
 * The design a standing building is drawn in: its own shell's architecture,
 * else its kit record's family. Null for the plain building and an empty lot.
 */
export async function standingDesign( dir, parcelId ) {

	const own = await json( join( dir, parcelId, blueprintFile( parcelId ) ) );
	if ( own ) return own.assembly?.architecture ?? null;
	return ( await json( join( dir, parcelId, placementsFile( parcelId ) ) ) )?.family ?? null;

}

/** The parcels among `ids` whose building stands in a proven design. */
export async function provenParcels( dir, ids ) {

	const designs = await Promise.all( ids.map( ( id ) => standingDesign( dir, id ) ) );
	return new Set( ids.filter( ( _, index ) => PROVEN_DESIGNS.has( designs[ index ] ) ) );

}

async function json( path ) {

	try {

		return JSON.parse( await readFile( path, 'utf8' ) );

	} catch ( error ) {

		if ( error.code === 'ENOENT' ) return null;
		throw error;

	}

}
