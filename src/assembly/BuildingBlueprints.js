import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AssemblyError } from './RequestAssembler.js';
import { blueprintFile, parcelBlueprint, placementsFile, planBlueprintFile, PLANS_FOLDER } from './kit/index.js';

/**
 * The blueprint of any building standing in an out dir.
 *
 * A generated shell publishes its own document beside its GLB. A kit parcel
 * carries only the plan it stands from and the frame it stands in, so its
 * document is composed from the plan's, which is read once however many
 * parcels of the city stand on it.
 */
export class BuildingBlueprints {

	constructor( dir ) {

		this.dir = dir;
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

		// A city has a few dozen plans and hundreds of buildings, so each plan is
		// read once and every parcel of it waits on that read.
		const plan = read( join( this.dir, PLANS_FOLDER, planBlueprintFile( id ) ) );

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
