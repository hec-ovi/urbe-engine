import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { validateWorldManifest } from './validators.js';

export const MANIFEST_FILE = 'manifest.json';
export const MANIFEST_VERSION = '1.0.0';
/** The blueprint the world was assembled from, so the folder is the whole world. */
export const BLUEPRINT_FILE = 'blueprint.json';
/** The naming box's typed set, carried in from beside the blueprint when it has one. */
export const NPC_TYPES_FILE = 'npc-types.json';

/** Zero-padded floor file tag; basements keep their minus sign (-001). */
export function floorTag( index ) {

	return `${index < 0 ? '-' : ''}${String( Math.abs( index ) ).padStart( 3, '0' )}`;

}

/**
 * The assembled world on disk. A blueprint changes between runs (lots merge,
 * ids move), and a parcel folder left behind by the old one is a whole building
 * standing in a place the city no longer has, which the game loads on top of
 * whatever stands there now. So the out dir is kept to exactly what the current
 * blueprint has, and the manifest says which blueprint that was, which shells
 * stand and which have interiors. This is the only list the game reads.
 */
export class OutDir {

	constructor( dir ) {

		this.dir = dir;

	}

	/**
	 * Drops every parcel folder that is not this blueprint's: an id the
	 * blueprint no longer has, and an id it still has but on a different lot,
	 * which the folder's own stored request gives away. Only folders assembly
	 * itself wrote are ever removed: one has to carry the request or the
	 * blueprint named after it.
	 * @param parcels the current blueprint's parcels
	 * @returns the ids removed
	 */
	prune( parcels ) {

		const footprints = new Map( parcels.map( ( parcel ) => [ parcel.id, JSON.stringify( parcel.footprint ) ] ) );
		const removed = [];

		for ( const name of this.#folders() ) {

			const path = join( this.dir, name );
			const request = join( path, `${name}.request.json` );
			const ours = existsSync( request ) || existsSync( join( path, `${name}.blueprint.json` ) );

			if ( ! ours ) continue;
			if ( footprints.has( name ) && this.#builtOn( request ) === footprints.get( name ) ) continue;

			rmSync( path, { recursive: true, force: true } );
			removed.push( name );

		}

		return removed;

	}

	/** Removes one parcel's folder, so a build that failed leaves nothing behind. */
	drop( parcelId ) {

		rmSync( join( this.dir, parcelId ), { recursive: true, force: true } );

	}

	/** Removes only furnished output. The exterior remains a valid closed shell. */
	dropInterior( parcelId ) {

		rmSync( join( this.dir, parcelId, 'interior' ), { recursive: true, force: true } );

	}

	/**
	 * The parcels whose exterior is complete on disk. These are the buildings
	 * that stand in the city whether or not they are enterable.
	 */
	shells( parcelIds ) {

		return parcelIds.filter( ( id ) => {

			const path = join( this.dir, id );

			return existsSync( join( path, `${id}.blueprint.json` ) )
				&& existsSync( join( path, `${id}.glb` ) );

		} );

	}

	/** The shell parcels whose furnished interior is complete and streamable. */
	interiors( parcelIds ) {

		const shells = new Set( this.shells( parcelIds ) );

		return parcelIds.filter( ( id ) => shells.has( id )
			&& existsSync( join( this.dir, id, 'interior', 'building.glb' ) )
			&& existsSync( join( this.dir, id, 'interior', 'npc.json' ) )
			&& this.floorsOf( id ) !== null );

	}

	/**
	 * The floor tags of one parcel, lowest first, or null when a floor document
	 * has no GLB beside it (or there are no floors at all).
	 */
	floorsOf( parcelId ) {

		const floorsDir = join( this.dir, parcelId, 'interior', 'floors' );

		if ( ! existsSync( floorsDir ) ) return null;

		const tags = readdirSync( floorsDir )
			.filter( ( name ) => name.endsWith( '.json' ) )
			.map( ( name ) => name.slice( 0, - 5 ) )
			.sort( ( a, b ) => Number( a ) - Number( b ) );

		if ( ! tags.length ) return null;

		return tags.every( ( tag ) => existsSync( join( floorsDir, `${tag}.glb` ) ) ) ? tags : null;

	}

	/**
	 * A named world comes with its typed NPC set beside it; the out dir takes a
	 * copy so the folder plays as one world. @returns whether one was found.
	 */
	carryTypes( blueprintPath ) {

		const source = join( dirname( blueprintPath ), NPC_TYPES_FILE );

		if ( ! existsSync( source ) ) return false;

		copyFileSync( source, join( this.dir, NPC_TYPES_FILE ) );

		return true;

	}

	/**
	 * Writes the manifest: the blueprint this world came from, every shell,
	 * the complete interior subset and only that subset's streamable floors.
	 * The game refuses an out dir whose blueprint is not the one it is playing.
	 */
	writeManifest( atlas, parcelIds, interiorIds ) {

		const parcels = [ ...parcelIds ].sort( ( a, b ) => a.localeCompare( b, undefined, { numeric: true } ) );
		const interiors = [ ...interiorIds ].sort( ( a, b ) => a.localeCompare( b, undefined, { numeric: true } ) );
		const shells = new Set( parcels );

		if ( interiors.some( ( id ) => ! shells.has( id ) || ! this.interiors( [ id ] ).includes( id ) ) ) {

			throw new Error( 'manifest interior must be a complete interior inside a listed shell parcel' );

		}

		const manifest = {
			contractVersion: MANIFEST_VERSION,
			seed: atlas.meta.seed,
			atlasVersion: atlas.meta.version,
			named: atlas.parcels.some( ( parcel ) => Boolean( parcel.name ) ),
			namingTheme: atlas.meta.naming?.theme ?? null,
			parcels,
			interiors,
			floors: Object.fromEntries( interiors.map( ( id ) => [ id, this.floorsOf( id ) ] ) )
		};
		const errors = validateWorldManifest( manifest );

		if ( errors.length ) throw new Error( `invalid world manifest: ${errors.map( ( error ) => `${error.instancePath || '/'} ${error.message}` ).join( '; ' )}` );

		writeFileSync( join( this.dir, MANIFEST_FILE ), JSON.stringify( manifest, null, 2 ) + '\n' );
		writeFileSync( join( this.dir, BLUEPRINT_FILE ), JSON.stringify( atlas ) + '\n' );

		return manifest;

	}

	/** The lot the folder's stored request was built on, or null when unreadable. */
	#builtOn( requestPath ) {

		try {

			return JSON.stringify( JSON.parse( readFileSync( requestPath, 'utf8' ) ).parcel.footprint );

		} catch {

			return null;

		}

	}

	#folders() {

		if ( ! existsSync( this.dir ) ) return [];

		return readdirSync( this.dir ).filter( ( name ) => statSync( join( this.dir, name ) ).isDirectory() );

	}

}
