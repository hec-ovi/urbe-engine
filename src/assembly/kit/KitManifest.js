import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { AssemblyError } from '../RequestAssembler.js';
import { sha256 } from '../JsonFile.js';
import { validateKitManifest, schemaMessage } from './KitSchemas.js';
import { share } from '../SharedResources.js';

/** Where Exterior's `npm run kit` publishes the pieces every ordinary building is made of. */
export const KIT_DIR = fileURLToPath( new URL( '../../../../exterior/out/kit/', import.meta.url ) );
/** The file the world manifest points the game at, inside the shared store. */
export const KIT_FILE = 'kit.json';

/**
 * The piece kit on disk: its families, the module they repeat on, what each
 * family fits, and the bytes the world manifest binds. Loaded once per city.
 */
export class KitManifest {

	/**
	 * @param dir the published kit directory; `URBE_KIT_DIR` overrides the
	 * sibling Exterior build for a machine that keeps it elsewhere
	 * @throws AssemblyError E_KIT_MANIFEST
	 */
	static load( dir = process.env.URBE_KIT_DIR || KIT_DIR ) {

		const file = join( dir, 'kit.json' );

		if ( ! existsSync( file ) ) {

			throw new AssemblyError( 'E_KIT_MANIFEST', `no piece kit at ${file}; run Exterior's kit CLI` );

		}

		const bytes = readFileSync( file );
		let kit = null;

		try {

			kit = JSON.parse( bytes.toString( 'utf8' ) );

		} catch ( error ) {

			throw new AssemblyError( 'E_KIT_MANIFEST', `${file} is not JSON: ${error.message}` );

		}

		const errors = validateKitManifest( kit );

		if ( errors.length ) throw new AssemblyError( 'E_KIT_MANIFEST', `kit schema: ${schemaMessage( errors )}` );

		return new KitManifest( dir, kit, sha256( bytes ) );

	}

	/**
	 * The kit at this directory, or null when the directory publishes none, so a
	 * machine that has not built Exterior's pieces still assembles its city and
	 * generates every building. A kit that is there but broken still stops the
	 * run with `E_KIT_MANIFEST`.
	 */
	static find( dir = process.env.URBE_KIT_DIR || KIT_DIR ) {

		return existsSync( join( dir, 'kit.json' ) ) ? KitManifest.load( dir ) : null;

	}

	constructor( dir, kit, hash ) {

		this.dir = dir;
		this.seed = kit.seed;
		this.module = kit.module;
		this.families = kit.families;
		/** The exact bytes of kit.json, which the manifest binds the world to. */
		this.sha256 = hash;

	}

	/** Family ids, in the kit's own order. */
	ids() {

		return this.families.map( ( family ) => family.id );

	}

	family( id ) {

		const family = this.families.find( ( entry ) => entry.id === id );

		if ( ! family ) throw new AssemblyError( 'E_KIT_MANIFEST', `the kit has no family ${id}` );

		return family;

	}

	/** Whether a family's published fits accept a lot of this many bays. */
	fitsLot( id, { across, deep } ) {

		const { bays } = this.family( id ).fits;

		return accepts( bays, across ) && accepts( bays, deep );

	}

	/** The floor counts a family accepts under a height limit, or null for none. */
	fitsFloors( id, maxHeight ) {

		const { fits: { floors }, bands } = this.family( id );
		const byHeight = Math.floor( ( maxHeight - bands.ground.height - bands.crown.height ) / bands.middle.height + 1e-9 ) + 2;
		const min = floors.minimum;
		const max = Math.min( floors.maximum ?? Infinity, byHeight );

		return max >= min ? { min, max } : null;

	}

	/**
	 * Puts the kit in the shared store, where every city built from it reads the
	 * same copy instead of carrying one each.
	 * @returns the manifest reference to that copy
	 */
	publish() {

		return { file: KIT_FILE, sha256: this.sha256, shared: share( 'kit', this.sha256, this.dir ) };

	}

}

function accepts( range, value ) {

	return value >= range.minimum && value <= ( range.maximum ?? Infinity )
		&& ( value - range.minimum ) % ( range.step ?? 1 ) === 0;

}
