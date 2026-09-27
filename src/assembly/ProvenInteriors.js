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

/**
 * A story's places for an automatic pick that the story is played in
 * afterwards: each place standing in another design gives its turn to a free
 * proven building of its kind, its own district first, then atlas order, as
 * Quests moves a place into the opened set. A place no proven building of its
 * kind can stand in for keeps its own, since the story needs it (a city's one
 * clinic or police station, say).
 */
export function provenStandIns( atlas, places, proven ) {

	const parcels = new Map( atlas.parcels.map( ( parcel ) => [ parcel.id, parcel ] ) );
	const taken = new Set( places.filter( ( id ) => proven.has( id ) ) );
	return places.map( ( id ) => {

		const place = parcels.get( id );
		if ( taken.has( id ) || ! place ) return id;
		const kind = atlas.parcels.filter( ( parcel ) => parcel.type === place.type && proven.has( parcel.id ) && ! taken.has( parcel.id ) );
		const standIn = ( kind.find( ( parcel ) => parcel.districtId === place.districtId ) ?? kind[ 0 ] )?.id ?? id;
		taken.add( standIn );
		return standIn;

	} );

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
