import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { hashJson } from '../world-archive/index.js';
import { validateShellCatalog, validateWorldManifest } from './validators.js';
import { WorldFiles } from './WorldFiles.js';
import { replaceFile, writeJsonFile } from './JsonFile.js';
import { AssemblyError } from './RequestAssembler.js';
import { blueprintFile, placementsFile } from './kit/KitFiles.js';
import { NPC_FILE } from './interiorRunner.js';

export const MANIFEST_FILE = 'manifest.json';
export const MANIFEST_VERSION = '1.0.0';
/** The blueprint the world was assembled from, so the folder is the whole world. */
export const BLUEPRINT_FILE = 'blueprint.json';
/** The naming box's typed set, carried in from beside the blueprint when it has one. */
export const NPC_TYPES_FILE = 'npc-types.json';
/** Interior's own index of one furnished building: its layouts, floors and connectors. */
export const INTERIOR_BUILDING_FILE = 'building.json';

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

		const ground = new Map( parcels.map( ( parcel ) => [ parcel.id, {
			footprint: ringKey( parcel.footprint ), lot: ringKey( parcel.lot )
		} ] ) );
		const removed = [];

		for ( const name of this.#folders() ) {

			const path = join( this.dir, name );
			const ours = existsSync( join( path, `${name}.request.json` ) )
				|| existsSync( join( path, blueprintFile( name ) ) )
				|| existsSync( join( path, placementsFile( name ) ) );
			const wanted = ground.get( name );
			const built = ours ? this.#builtOn( path, name ) : null;

			if ( ! ours ) continue;
			if ( wanted && built && ( built === wanted.footprint || built === wanted.lot ) ) continue;

			rmSync( path, { recursive: true, force: true } );
			removed.push( name );

		}

		return removed;

	}

	/** Removes one parcel's folder, so a build that failed leaves nothing behind. */
	drop( parcelId ) {

		rmSync( join( this.dir, parcelId ), { recursive: true, force: true } );

	}

	/**
	 * Removes a kit placement table, for a parcel the generator builds now. The
	 * table names the pieces of the building that stood here before, and a
	 * folder carrying both is drawn from the stale one.
	 */
	dropPlacements( parcelId ) {

		rmSync( join( this.dir, parcelId, placementsFile( parcelId ) ), { force: true } );

	}

	/** Removes only furnished output. The exterior remains a valid closed shell. */
	dropInterior( parcelId ) {

		rmSync( join( this.dir, parcelId, 'interior' ), { recursive: true, force: true } );

	}

	/**
	 * The parcels whose exterior is complete on disk, whether or not they are
	 * enterable. A generated shell stands as its own GLB and blueprint; a kit
	 * parcel stands as its placement record, which names the plan both its
	 * pieces and its blueprint come from.
	 */
	shells( parcelIds ) {

		return parcelIds.filter( ( id ) => {

			const path = join( this.dir, id );

			return existsSync( join( path, placementsFile( id ) ) )
				|| ( existsSync( join( path, blueprintFile( id ) ) ) && existsSync( join( path, `${id}.glb` ) ) );

		} );

	}

	/** The parcels standing as kit buildings: their placement record is on disk. */
	kits( parcelIds ) {

		return parcelIds.filter( ( id ) => existsSync( join( this.dir, id, placementsFile( id ) ) ) );

	}

	/** Which building plan each standing kit parcel names. @returns Map<parcelId, plan id> */
	kitPlans( parcelIds ) {

		const named = new Map();

		for ( const id of this.kits( parcelIds ) ) {

			const plan = readJson( join( this.dir, id, placementsFile( id ) ) )?.plan;
			if ( plan ) named.set( id, plan );

		}

		return named;

	}

	/** The shell parcels whose furnished interior is complete. */
	interiors( parcelIds ) {

		const shells = new Set( this.shells( parcelIds ) );

		return parcelIds.filter( ( id ) => shells.has( id ) && this.floorsOf( id ) !== null );

	}

	/**
	 * The floor tags of one parcel, lowest first, or null when the building
	 * document, a layout one of its floors names or its NPC support is missing.
	 * A building publishes the layouts its floors use (ground and crown alone
	 * for two floors). A furnished building is JSON alone: its geometry is the
	 * city's shared module set, so there is nothing per floor to stream.
	 */
	floorsOf( parcelId ) {

		const interiorDir = join( this.dir, parcelId, 'interior' );
		const building = readJson( join( interiorDir, INTERIOR_BUILDING_FILE ) );
		const layouts = building?.layouts ?? {};

		if ( ! building?.floors?.length || ! building.floors.every( ( floor ) => floor.layout in layouts ) ) return null;
		if ( ! existsSync( join( interiorDir, NPC_FILE ) ) ) return null;
		if ( ! Object.values( layouts ).every( ( file ) => existsSync( join( interiorDir, file ) ) ) ) return null;

		return building.floors.map( ( floor ) => floorTag( floor.index ) ).sort( ( a, b ) => Number( a ) - Number( b ) );

	}

	/**
	 * A named world comes with its typed NPC set beside it; the out dir takes a
	 * copy so the folder plays as one world. @returns whether one was found.
	 */
	carryTypes( blueprintPath ) {

		const source = join( dirname( blueprintPath ), NPC_TYPES_FILE );
		const target = join( this.dir, NPC_TYPES_FILE );

		if ( ! existsSync( source ) ) return false;
		if ( resolve( source ) !== resolve( target ) ) replaceFile( target, readFileSync( source ) );

		return true;

	}

	/**
	 * Writes the manifest: the blueprint this world came from, every shell,
	 * the complete interior subset and only that subset's streamable floors.
	 * The game refuses an out dir whose blueprint is not the one it is playing.
	 */
	writeManifest( atlas, parcelIds, interiorIds, rooftopSpans = null, connectionsArtifact = null ) {

		const references = connectionsArtifact ? { connections: connectionsArtifact.referenceFor( hashJson( atlas ) ) } : {};
		const manifest = this.#manifest( atlas, parcelIds, interiorIds, rooftopSpans, references );
		writeJsonFile( join( this.dir, BLUEPRINT_FILE ), atlas );
		connectionsArtifact?.write( this.dir );
		replaceFile( join( this.dir, MANIFEST_FILE ), JSON.stringify( manifest, null, 2 ) + '\n' );
		return manifest;

	}

	/** Publishes bounded archives and references their exact index bytes. */
	async writeArchiveManifest( atlas, parcelIds, interiorIds, rooftopSpans = null, connectionsArtifact = null, options ) {

		return this.publishManifest( atlas, parcelIds, interiorIds, {
			rooftopSpans, connectionsArtifact, encoding: 'archive', archiveOptions: options
		} );

	}

	/** Publishes source documents and a compact shell catalog as one world. */
	async publishManifest( atlas, parcelIds, interiorIds, {
		rooftopSpans = null, connectionsArtifact = null, catalog = null, encoding = 'json', archiveOptions, streets = false,
		streetsPrepared = null, kit = null, interiorModules = null, interiorProps = null, sources = null, buildings = null
	} = {} ) {

		if ( ! [ 'json', 'archive' ].includes( encoding ) ) throw new AssemblyError( 'E_REQUEST_INVALID', 'unknown world document encoding' );
		if ( streets && encoding !== 'json' ) throw new AssemblyError( 'E_STREETS_ARCHIVE_UNSUPPORTED', 'native streets require an ordinary staged blueprint.json' );
		if ( streets !== false && streets !== true && ( ! streets || typeof streets !== 'object' || Array.isArray( streets ) ) ) throw new AssemblyError( 'E_REQUEST_INVALID', 'streets must be true, false or native street options' );
		if ( catalog ) this.#checkCatalog( atlas, parcelIds, catalog );
		const files = new WorldFiles( this.dir );
		try {

			const references = await files.prepare( atlas, connectionsArtifact, { encoding, archiveOptions, catalog, streets, streetsPrepared } );
			const manifest = this.#manifest( atlas, parcelIds, interiorIds, rooftopSpans, {
				...references, ...( kit ? { kit } : {} ), ...( interiorModules ? { interiorModules } : {} ),
				...( interiorProps ? { interiorProps } : {} ), ...( sources ? { sources } : {} ),
				...( buildings ? { buildings } : {} )
			} );
			files.publish( manifest );
			return manifest;

		} finally { files.dispose(); }

	}

	#checkCatalog( atlas, parcelIds, catalog ) {

		const errors = validateShellCatalog( catalog );
		if ( errors.length ) throw new AssemblyError( 'E_SHELL_CATALOG', `catalog schema: ${errors[ 0 ].instancePath} ${errors[ 0 ].message}` );
		const ids = new Set( catalog.buildings.map( building => building.id ) );
		if ( catalog.seed !== atlas.meta.seed || ids.size !== catalog.buildings.length
			|| ids.size !== parcelIds.length || parcelIds.some( id => ! ids.has( id ) ) ) {

			throw new AssemblyError( 'E_SHELL_CATALOG', 'catalog seed and shell IDs must equal the published world' );

		}

	}

	#manifest( atlas, parcelIds, interiorIds, rooftopSpans, references ) {

		const parcels = [ ...parcelIds ].sort( ( a, b ) => a.localeCompare( b, undefined, { numeric: true } ) );
		const interiors = [ ...interiorIds ].sort( ( a, b ) => a.localeCompare( b, undefined, { numeric: true } ) );
		const shells = new Set( parcels );

		if ( interiors.some( ( id ) => ! shells.has( id ) || ! this.interiors( [ id ] ).includes( id ) ) ) {

			throw new Error( 'manifest interior must be a complete interior inside a listed shell parcel' );

		}

		for ( const [ id, source ] of Object.entries( references.sources ?? {} ) ) {

			// An empty lot is a parcel the city deliberately has no building on:
			// it is named here and stands in no other list.
			if ( source === 'empty' ? shells.has( id ) : ! shells.has( id ) ) {

				throw new Error( `manifest source ${id} is ${source}, which does not match what stands` );

			}
			if ( source === 'kit' && ! references.kit ) throw new Error( `manifest source ${id} is kit, but no kit is published` );

		}

		for ( const id of Object.keys( references.buildings ?? {} ) ) {

			if ( references.sources?.[ id ] !== 'kit' ) throw new Error( `manifest building ${id} is not a kit parcel` );

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
		if ( rooftopSpans ) manifest.rooftopSpans = rooftopSpans;
		Object.assign( manifest, references );
		const errors = validateWorldManifest( manifest );

		if ( errors.length ) throw new Error( `invalid world manifest: ${errors.map( ( error ) => `${error.instancePath || '/'} ${error.message}` ).join( '; ' )}` );

		return manifest;

	}

	/**
	 * The ground the folder says it was built on: the stored request's
	 * footprint for a generated shell, the lot for a kit table. Null when the
	 * folder carries neither.
	 */
	#builtOn( path, id ) {

		const request = readJson( join( path, `${id}.request.json` ) );

		if ( request ) return ringKey( request.parcel?.footprint );

		const placements = readJson( join( path, placementsFile( id ) ) );

		return placements ? ringKey( placements.lot ) : null;

	}

	#folders() {

		if ( ! existsSync( this.dir ) ) return [];

		return readdirSync( this.dir ).filter( ( name ) => statSync( join( this.dir, name ) ).isDirectory() );

	}

}

/** A ring as its own corners, so the same ground compares equal however it is wound. */
function ringKey( ring ) {

	return Array.isArray( ring ) ? JSON.stringify( ring.map( ( point ) => `${point}` ).sort() ) : null;

}

function readJson( path ) {

	try {

		return JSON.parse( readFileSync( path, 'utf8' ) );

	} catch {

		return null;

	}

}
