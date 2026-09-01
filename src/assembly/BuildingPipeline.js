import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { AssemblyError } from './RequestAssembler.js';
import { floorTag } from './OutDir.js';
import { runInterior, runCoreFeasibility } from './interiorRunner.js';
import { validateExteriorRequest, validateInteriorRequest } from './validators.js';

const EXTERIOR_DIR = fileURLToPath( new URL( '../../../exterior/', import.meta.url ) );

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

		writeInteriorFiles( join( outDir, 'interior' ), interior );

	}

}

/**
 * One InteriorResult on disk: the whole building for the viewer, and per floor
 * its document plus its own GLB under `floors/`, which is what the game streams.
 */
export function writeInteriorFiles( interiorDir, { glb, floorGlbs, floors, npc } ) {

	const floorsDir = join( interiorDir, 'floors' );

	mkdirSync( floorsDir, { recursive: true } );
	writeFileSync( join( interiorDir, 'building.glb' ), glb );
	writeFileSync( join( interiorDir, 'npc.json' ), JSON.stringify( npc, null, 2 ) + '\n' );

	for ( const floor of floors ) {

		writeFileSync( join( floorsDir, `${floorTag( floor.floor )}.json` ), JSON.stringify( floor, null, 2 ) + '\n' );

	}

	for ( const [ index, bytes ] of floorGlbs ) {

		writeFileSync( join( floorsDir, `${floorTag( index )}.glb` ), bytes );

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
