import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { AssemblyError } from './RequestAssembler.js';
import { runInterior, runCoreFeasibility } from './interiorRunner.js';
import { validateExteriorRequest, validateInteriorRequest } from './validators.js';

const EXTERIOR_DIR = fileURLToPath( new URL( '../../../exterior/', import.meta.url ) );

/** Zero-padded floor file name; basements keep their minus sign (-001). */
export function floorFileName( index ) {

	const digits = String( Math.abs( index ) ).padStart( 3, '0' );

	return `${index < 0 ? '-' : ''}${digits}.json`;

}

/**
 * The per-parcel chain shared by the single and city CLIs: assemble and
 * validate the exterior request, run exterior's CLI, then optionally gate on
 * interior core feasibility (walkup parcels re-pick floors inside the cap and
 * regenerate the shell) and fill the building. Failures throw AssemblyError;
 * nothing here exits the process.
 */
export class BuildingPipeline {

	constructor( assembler ) {

		this.assembler = assembler;

	}

	/**
	 * @param options.glb 'merged' (runtime default) | 'named'
	 * @param options.interior also generate the interior into <outDir>/interior/
	 * @returns { request, blueprint, coreMode } for the built parcel
	 */
	async build( parcelId, outDir, { glb = 'merged', interior = false } = {} ) {

		mkdirSync( outDir, { recursive: true } );

		let { request, blueprint } = await this.#shell( parcelId, outDir, { glb } );
		let coreMode = null;

		if ( interior ) {

			let core = await runCoreFeasibility( blueprint );

			if ( core.mode === 'walkup' && request.building.floors > core.walkupMaxFloors ) {

				( { request, blueprint } = await this.#shell( parcelId, outDir, { glb, floorCap: core.walkupMaxFloors } ) );
				core = await runCoreFeasibility( blueprint );

			}

			if ( ! core.fits ) {

				throw new AssemblyError( 'E_CORE_INFEASIBLE',
					`mode ${core.mode}: band ${core.bandLength} m, core ${core.minCoreLength} m, compact ${core.minCompactCoreLength} m, walkup ${core.minWalkupCoreLength} m (crossDepthOk ${core.crossDepthOk})` );

			}

			coreMode = core.mode;
			await this.#generateInterior( parcelId, blueprint, outDir );

		}

		return { request, blueprint, coreMode };

	}

	/**
	 * The shell, with the parcel's venue sign on it. A facade too small for the
	 * word throws E_SIGNAGE_TEXT_TOO_LONG; that building wears no sign rather
	 * than failing the parcel.
	 */
	async #shell( parcelId, outDir, options ) {

		const request = this.#assembleValidated( parcelId, options );

		try {

			return { request, blueprint: await this.#generateExterior( request, outDir ) };

		} catch ( error ) {

			if ( ! request.options.signage || ! error.message.includes( 'E_SIGNAGE_TEXT_TOO_LONG' ) ) throw error;

		}

		const bare = this.#assembleValidated( parcelId, { ...options, signage: false } );

		return { request: bare, blueprint: await this.#generateExterior( bare, outDir ) };

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

	async #generateExterior( request, outDir ) {

		const requestPath = join( outDir, `${request.buildingId}.request.json` );
		writeFileSync( requestPath, JSON.stringify( request, null, 2 ) + '\n' );

		const { status, output } = await new Promise( ( resolvePromise ) => {

			const child = spawn( 'npm', [ 'run', 'generate', '--silent', '--', requestPath, outDir, '--keys-only' ], {
				cwd: EXTERIOR_DIR,
				stdio: [ 'ignore', 'pipe', 'pipe' ]
			} );

			let output = '';
			child.stdout.on( 'data', ( d ) => { output += d; } );
			child.stderr.on( 'data', ( d ) => { output += d; } );
			child.on( 'close', ( status ) => resolvePromise( { status, output } ) );

		} );

		if ( status !== 0 ) {

			const line = output.split( '\n' ).find( ( l ) => l.includes( 'E_' ) ) ?? output.trim().slice( 0, 300 );

			throw new AssemblyError( 'E_EXTERIOR_FAILED', line.trim() );

		}

		return JSON.parse( readFileSync( join( outDir, `${request.buildingId}.blueprint.json` ), 'utf8' ) );

	}

	async #generateInterior( parcelId, blueprint, outDir ) {

		const interiorRequest = this.assembler.assembleInterior( parcelId, {
			blueprint,
			shellGlb: join( outDir, `${parcelId}.glb` )
		} );
		const errors = validateInteriorRequest( interiorRequest );

		if ( errors.length > 0 ) {

			throw new AssemblyError( 'E_REQUEST_INVALID',
				`interior schema: ${errors.map( ( e ) => `${e.instancePath || '/'} ${e.message}` ).join( '; ' )}` );

		}

		let interior;

		try {

			interior = await runInterior( interiorRequest );

		} catch ( error ) {

			throw new AssemblyError( 'E_INTERIOR_FAILED', `${error.code ?? error.name}: ${error.message}` );

		}

		const interiorDir = join( outDir, 'interior' );
		mkdirSync( join( interiorDir, 'floors' ), { recursive: true } );
		writeFileSync( join( interiorDir, 'building.glb' ), interior.glb );
		writeFileSync( join( interiorDir, 'npc.json' ), JSON.stringify( interior.npc, null, 2 ) + '\n' );

		for ( const floor of interior.floors ) {

			writeFileSync( join( interiorDir, 'floors', floorFileName( floor.floor ) ), JSON.stringify( floor, null, 2 ) + '\n' );

		}

	}

}
