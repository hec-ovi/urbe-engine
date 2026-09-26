import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AssemblyError } from './RequestAssembler.js';
import { replaceFile } from './JsonFile.js';
import { runInterior, runCoreFeasibility } from './interiorRunner.js';
import { validateExteriorRequest, validateInteriorRequest } from './validators.js';

/**
 * The per-parcel chain shared by the single and city CLIs: assemble and
 * validate the exterior request, generate it on an Exterior worker, then
 * optionally gate on interior core feasibility (walkup parcels re-pick floors
 * inside the cap and regenerate the shell) and furnish it. A building that
 * already stands is furnished on its own through `furnish`. Failures throw
 * AssemblyError; nothing here exits the process.
 */
export class BuildingPipeline {

	/** @param exterior the ExteriorWorkers every shell is generated on */
	constructor( assembler, { exterior = null } = {} ) {

		this.assembler = assembler;
		this.exterior = exterior;

	}

	/**
	 * @param options.glb 'merged' (runtime default) | 'named'
	 * @param options.interior also furnish the building into <outDir>/interior/
	 * @returns { request, blueprint, coreMode } for the built parcel
	 */
	async build( parcelId, outDir, { glb = 'merged', interior = false } = {} ) {

		mkdirSync( outDir, { recursive: true } );

		const shell = await this.#shell( parcelId, outDir, { glb } );

		if ( ! interior ) return { ...shell, coreMode: null };

		const furnished = await this.furnish( parcelId, outDir, { blueprint: shell.blueprint, glb } );

		return { ...shell, ...furnished, request: furnished.request ?? shell.request };

	}

	/**
	 * Furnishes a building that already stands, from its own blueprint: the kit
	 * table's or the generated shell's. A generated shell whose core only fits a
	 * walkup re-picks its floors inside the cap and is regenerated, so `refit`
	 * is false for a kit building, which keeps its pieces or stays closed.
	 * @returns { request, blueprint, coreMode }; request is set only on a re-pick
	 */
	async furnish( parcelId, outDir, { blueprint, glb = 'merged', refit = true } = {} ) {

		let request = null;
		let core = await runCoreFeasibility( blueprint );

		if ( refit && core.mode === 'walkup' && aboveGround( blueprint ) > core.walkupMaxFloors ) {

			( { request, blueprint } = await this.#shell( parcelId, outDir, { glb, floorCap: core.walkupMaxFloors } ) );
			core = await runCoreFeasibility( blueprint );

		}

		if ( ! core.fits ) {

			throw new AssemblyError( 'E_CORE_INFEASIBLE',
				`mode ${core.mode}: band ${core.bandLength} m, core ${core.minCoreLength} m, compact ${core.minCompactCoreLength} m, walkup ${core.minWalkupCoreLength} m (crossDepthOk ${core.crossDepthOk})` );

		}

		await this.#generateInterior( parcelId, blueprint, outDir );

		return { request, blueprint, coreMode: core.mode };

	}

	/**
	 * The shell with its sign: the parcel's name, else its venue word, else
	 * none. A facade too small for the text throws E_SIGNAGE_TEXT_TOO_LONG and
	 * the building steps down one rung rather than failing the parcel.
	 */
	async #shell( parcelId, outDir, options ) {

		for ( const { request, text } of signRungs( ( signage ) => this.#assembleValidated( parcelId, { ...options, signage } ) ) ) {

			try {

				return { request, blueprint: await this.#generateExterior( request, outDir ) };

			} catch ( error ) {

				if ( text === null || ! error.message.includes( 'E_SIGNAGE_TEXT_TOO_LONG' ) ) throw error;

			}

		}

	}

	#assembleValidated( parcelId, options ) {

		const request = this.assembler.assemble( parcelId, options );
		const errors = validateExteriorRequest( request );

		if ( errors.length > 0 ) {

			throw new AssemblyError( 'E_REQUEST_INVALID',
				`exterior schema: ${errors.map( ( e ) => `${e.instancePath || '/'} ${e.message}` ).join( '; ' )}` );

		}

		return request;

	}

	#generateExterior( request, outDir ) {

		replaceFile( join( outDir, `${request.buildingId}.request.json` ), JSON.stringify( request, null, 2 ) + '\n' );

		return this.exterior.run( request, outDir );

	}

	async #generateInterior( parcelId, blueprint, outDir ) {

		const shellGlb = join( outDir, `${parcelId}.glb` );
		const interiorRequest = this.assembler.assembleInterior( parcelId, {
			blueprint,
			// A building standing from kit pieces has no GLB of its own.
			shellGlb: existsSync( shellGlb ) ? shellGlb : null
		} );
		const errors = validateInteriorRequest( interiorRequest );

		if ( errors.length > 0 ) {

			throw new AssemblyError( 'E_REQUEST_INVALID',
				`interior schema: ${errors.map( ( e ) => `${e.instancePath || '/'} ${e.message}` ).join( '; ' )}` );

		}

		try {

			return await runInterior( interiorRequest, join( outDir, 'interior' ) );

		} catch ( error ) {

			throw new AssemblyError( 'E_INTERIOR_FAILED', `${error.code ?? error.name}: ${error.message}` );

		}

	}

}

/**
 * The requests worth trying for one shell, one per distinct sign text: the
 * name, the venue word, none. A building with no sign at all yields once, with
 * no text, so it is still generated.
 */
export function* signRungs( assemble ) {

	const tried = new Set();

	for ( const signage of [ 'name', 'venue', 'none' ] ) {

		const request = assemble( signage );
		const text = request.options.signage?.text ?? null;

		if ( tried.has( text ) ) continue;

		tried.add( text );
		yield { request, text };

	}

}

/** The storeys a building has at or above the street, basements excluded. */
function aboveGround( blueprint ) {

	return blueprint.floors.filter( ( floor ) => floor.index >= 0 ).length;

}
