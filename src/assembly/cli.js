/**
 * npm run assemble -- --parcel <id> --out <dir> [--glb merged|named] [--interior]
 * Loads the atlas sample, generates the connections document, assembles the
 * parcel's BuildingRequest, validates it against exterior's schema, writes it,
 * then invokes exterior's CLI to produce the GLB and blueprint in <dir>.
 * With --interior (named shell required, so merged mode is a usage error) it
 * then assembles the InteriorRequest, validates it, runs interior's library and
 * writes building.glb, floors/*.json and npc.json to <dir>/interior/.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { RequestAssembler } from './RequestAssembler.js';
import { runConnections } from './connectionsRunner.js';
import { runInterior, runCoreFeasibility } from './interiorRunner.js';
import { validateExteriorRequest, validateInteriorRequest } from './validators.js';

const ATLAS_SAMPLE = new URL( '../../../atlas/samples/city-urbe.json', import.meta.url );
const EXTERIOR_DIR = fileURLToPath( new URL( '../../../exterior/', import.meta.url ) );

function parseArgs( argv ) {

	const args = { glb: null, interior: false };

	for ( let i = 0; i < argv.length; i ++ ) {

		const key = argv[ i ];

		if ( key === '--interior' ) args.interior = true;
		else if ( key === '--parcel' ) args.parcel = argv[ ++ i ];
		else if ( key === '--out' ) args.out = argv[ ++ i ];
		else if ( key === '--glb' ) args.glb = argv[ ++ i ];
		else return null;

	}

	if ( ! args.parcel || ! args.out ) return null;
	if ( args.interior && args.glb === 'merged' ) return null;
	if ( args.glb === null ) args.glb = args.interior ? 'named' : 'merged';
	if ( ! [ 'merged', 'named' ].includes( args.glb ) ) return null;

	return args;

}

function fail( code, detail ) {

	console.error( detail ? `${code}: ${detail}` : code );
	process.exit( 1 );

}

function printSchemaErrors( errors ) {

	for ( const e of errors ) console.error( `  ${e.instancePath || '/'} ${e.message}` );

}

function listFiles( dir, prefix = '' ) {

	for ( const name of readdirSync( dir ).sort() ) {

		const path = join( dir, name );

		if ( statSync( path ).isDirectory() ) listFiles( path, `${prefix}${name}/` );
		else console.log( `${prefix}${name}  ${statSync( path ).size} bytes` );

	}

}

/** Zero-padded floor file name; basements keep their minus sign (-001). */
function floorFileName( index ) {

	const digits = String( Math.abs( index ) ).padStart( 3, '0' );

	return `${index < 0 ? '-' : ''}${digits}.json`;

}

const args = parseArgs( process.argv.slice( 2 ) );

if ( ! args ) {

	console.error( 'usage: npm run assemble -- --parcel <id> --out <dir> [--glb merged|named] [--interior]' );
	console.error( '  --interior needs the named shell; combining it with --glb merged is an error' );
	process.exit( 2 );

}

const atlas = JSON.parse( readFileSync( ATLAS_SAMPLE, 'utf8' ) );
const connections = await runConnections( atlas, { seed: atlas.meta.seed } );
const assembler = new RequestAssembler( atlas, connections );
const outDir = resolve( args.out );
mkdirSync( outDir, { recursive: true } );

function assembleValidated( floorCap ) {

	let request;

	try {

		request = assembler.assemble( args.parcel, { glb: args.glb, floorCap } );

	} catch ( error ) {

		fail( error.code ?? 'ERROR', error.message );

	}

	const errors = validateExteriorRequest( request );

	if ( errors.length > 0 ) {

		console.error( 'E_REQUEST_INVALID: request fails exterior schema' );
		printSchemaErrors( errors );
		process.exit( 1 );

	}

	return request;

}

/** Writes the request, runs exterior's CLI, returns the blueprint. */
function generateExterior( request ) {

	const requestPath = join( outDir, `${request.buildingId}.request.json` );
	writeFileSync( requestPath, JSON.stringify( request, null, 2 ) + '\n' );

	const result = spawnSync( 'npm', [ 'run', 'generate', '--', requestPath, outDir ], {
		cwd: EXTERIOR_DIR,
		stdio: [ 'ignore', 'pipe', 'pipe' ],
		encoding: 'utf8'
	} );

	if ( result.status !== 0 ) {

		console.error( 'E_EXTERIOR_FAILED: exterior CLI exited', result.status );
		console.error( ( result.stderr ?? '' ).trim() );
		console.error( ( result.stdout ?? '' ).trim() );
		process.exit( 1 );

	}

	return JSON.parse( readFileSync( join( outDir, `${request.buildingId}.blueprint.json` ), 'utf8' ) );

}

let request = assembleValidated( null );
let blueprint = generateExterior( request );

if ( args.interior ) {

	let core = await runCoreFeasibility( blueprint );

	if ( core.mode === 'walkup' && request.building.floors > core.walkupMaxFloors ) {

		// Tight footprint: stair-only core. Re-pick floors inside the walkup
		// cap and regenerate the shell before running interior.
		request = assembleValidated( core.walkupMaxFloors );
		blueprint = generateExterior( request );
		core = await runCoreFeasibility( blueprint );

	}

	if ( ! core.fits ) {

		fail( 'E_CORE_INFEASIBLE',
			`mode ${core.mode}: band ${core.bandLength} m, core ${core.minCoreLength} m, compact ${core.minCompactCoreLength} m, walkup ${core.minWalkupCoreLength} m (crossDepthOk ${core.crossDepthOk})` );

	}

	const shellGlb = join( outDir, `${request.buildingId}.glb` );
	const interiorRequest = assembler.assembleInterior( args.parcel, { blueprint, shellGlb } );
	const interiorErrors = validateInteriorRequest( interiorRequest );

	if ( interiorErrors.length > 0 ) {

		console.error( 'E_REQUEST_INVALID: request fails interior schema' );
		printSchemaErrors( interiorErrors );
		process.exit( 1 );

	}

	let interior;

	try {

		interior = await runInterior( interiorRequest );

	} catch ( error ) {

		fail( 'E_INTERIOR_FAILED', `${error.code ?? error.name}: ${error.message}` );

	}

	const interiorDir = join( outDir, 'interior' );
	mkdirSync( join( interiorDir, 'floors' ), { recursive: true } );
	writeFileSync( join( interiorDir, 'building.glb' ), interior.glb );
	writeFileSync( join( interiorDir, 'npc.json' ), JSON.stringify( interior.npc, null, 2 ) + '\n' );

	for ( const floor of interior.floors ) {

		writeFileSync( join( interiorDir, 'floors', floorFileName( floor.floor ) ), JSON.stringify( floor, null, 2 ) + '\n' );

	}

}

listFiles( outDir );
