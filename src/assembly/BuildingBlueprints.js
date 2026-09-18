import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AssemblyError } from './RequestAssembler.js';
import { blueprintFile, parcelBlueprint, placementsFile } from './kit/index.js';

/**
 * The blueprint of any building standing in an out dir.
 *
 * A generated shell publishes its own document beside its GLB. A kit parcel
 * carries only the plan it stands from and the frame it stands in, so its
 * document is composed from the plan's, which is read once from the shared
 * store however many parcels of the city stand on it.
 */
export class BuildingBlueprints {

	/** @param library the PlanLibrary that says where a plan's blueprint stands */
	constructor( dir, library ) {

		this.dir = dir;
		this.library = library;
		this.plans = new Map();

	}

	/**
	 * @returns the parcel's blueprint
	 * @throws AssemblyError E_SHELL_BLUEPRINT when the building's own files are
	 * missing or unreadable
	 */
	async of( parcelId ) {

		const own = join( this.dir, parcelId, blueprintFile( parcelId ) );

		if ( existsSync( own ) ) return read( own );

		const record = await read( join( this.dir, parcelId, placementsFile( parcelId ) ) );

		return parcelBlueprint( await this.#plan( record.plan ), record );

	}

	#plan( id ) {

		const held = this.plans.get( id );

		if ( held ) return held;

		// A city has a hundred or so plans and hundreds of buildings, so each plan
		// is held once and every parcel of it waits on that one read. A plan the
		// library drew this run is already parsed; one read off an earlier run's
		// store is read here.
		const plan = this.library.blueprint( id ) ?? read( this.library.blueprintPath( id ) );

		this.plans.set( id, plan );

		return plan;

	}

}

async function read( path ) {

	try {

		return JSON.parse( await readFile( path, 'utf8' ) );

	} catch ( error ) {

		throw new AssemblyError( 'E_SHELL_BLUEPRINT', `${path}: ${error.message}` );

	}

}
