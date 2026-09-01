/**
 * npm run assemble -- --parcel <id> --out <dir> [--glb merged|named]
 * Loads the atlas sample, generates the connections document, assembles the
 * parcel's BuildingRequest, validates it against exterior's schema, writes it,
 * then invokes exterior's CLI to produce the GLB and blueprint in <dir>.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { RequestAssembler } from './RequestAssembler.js';
import { runConnections } from './connectionsRunner.js';
import { validateRequest } from './validateRequest.js';

const ATLAS_SAMPLE = new URL( '../../../atlas/samples/city-urbe.json', import.meta.url );
const EXTERIOR_DIR = fileURLToPath( new URL( '../../../exterior/', import.meta.url ) );

function parseArgs( argv ) {

	const args = { glb: 'merged' };

	for ( let i = 0; i < argv.length; i += 2 ) {

		const key = argv[ i ];
		const value = argv[ i + 1 ];

		if ( key === '--parcel' ) args.parcel = value;
		else if ( key === '--out' ) args.out = value;
		else if ( key === '--glb' ) args.glb = value;
		else return null;

	}

	if ( ! args.parcel || ! args.out || ! [ 'merged', 'named' ].includes( args.glb ) ) return null;

	return args;

}

const args = parseArgs( process.argv.slice( 2 ) );

if ( ! args ) {

	console.error( 'usage: npm run assemble -- --parcel <id> --out <dir> [--glb merged|named]' );
	process.exit( 2 );

}

const atlas = JSON.parse( readFileSync( ATLAS_SAMPLE, 'utf8' ) );
const connections = await runConnections( atlas, { seed: atlas.meta.seed } );
const assembler = new RequestAssembler( atlas, connections );

let request;

try {

	request = assembler.assemble( args.parcel, { glb: args.glb } );

} catch ( error ) {

	console.error( `${error.code ?? 'ERROR'}: ${error.message}` );
	process.exit( 1 );

}

const errors = validateRequest( request );

if ( errors.length > 0 ) {

	console.error( 'E_REQUEST_INVALID: request fails exterior schema' );
	for ( const e of errors ) console.error( `  ${e.instancePath || '/'} ${e.message}` );
	process.exit( 1 );

}

const outDir = resolve( args.out );
mkdirSync( outDir, { recursive: true } );

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

for ( const name of readdirSync( outDir ).sort() ) {

	console.log( `${name}  ${statSync( join( outDir, name ) ).size} bytes` );

}
