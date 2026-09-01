import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const MANIFEST_FILE = 'manifest.json';

/**
 * The assembled world on disk. A blueprint changes between runs (lots merge,
 * ids move), and a parcel folder left behind by the old one is a whole building
 * standing in a place the city no longer has, which the game loads on top of
 * whatever stands there now. So the out dir is kept to exactly what the current
 * blueprint has, and the manifest says which blueprint that was and which
 * parcels really finished, which is the only list the game reads.
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

	/** The parcels whose build is complete on disk: shell blueprint and interior. */
	built( parcelIds ) {

		return parcelIds.filter( ( id ) => {

			const path = join( this.dir, id );

			return existsSync( join( path, `${id}.blueprint.json` ) )
				&& existsSync( join( path, 'interior', 'building.glb' ) )
				&& existsSync( join( path, 'interior', 'npc.json' ) );

		} );

	}

	/**
	 * Writes the manifest: the blueprint this world came from and the parcels
	 * standing in it. The game refuses an out dir whose blueprint is not the
	 * one it is playing.
	 */
	writeManifest( atlas, parcelIds ) {

		const manifest = {
			seed: atlas.meta.seed,
			atlasVersion: atlas.meta.version,
			parcels: [ ...parcelIds ].sort( ( a, b ) => a.localeCompare( b, undefined, { numeric: true } ) )
		};

		writeFileSync( join( this.dir, MANIFEST_FILE ), JSON.stringify( manifest, null, 2 ) + '\n' );

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
