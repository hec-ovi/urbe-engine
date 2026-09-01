/**
 * npm run assemble -- --parcel <id> --out <dir> [--blueprint <path>] [--glb merged|named] [--interior]
 * Loads the atlas blueprint (the committed urbe sample by default), generates
 * the connections document, then runs the building pipeline for one parcel:
 * request written and validated, exterior GLB and blueprint, and with
 * --interior the core-gated interior (building.glb, floors/*.json, npc.json)
 * under <dir>/interior/.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { RequestAssembler } from './RequestAssembler.js';
import { runConnections } from './connectionsRunner.js';
import { BuildingPipeline } from './BuildingPipeline.js';

const ATLAS_SAMPLE = fileURLToPath( new URL( '../../../atlas/samples/city-urbe.json', import.meta.url ) );

function parseArgs( argv ) {

	const args = { glb: 'merged', interior: false, blueprint: ATLAS_SAMPLE };

	for ( let i = 0; i < argv.length; i ++ ) {

		const key = argv[ i ];

		if ( key === '--interior' ) args.interior = true;
		else if ( key === '--parcel' ) args.parcel = argv[ ++ i ];
		else if ( key === '--out' ) args.out = argv[ ++ i ];
		else if ( key === '--glb' ) args.glb = argv[ ++ i ];
		else if ( key === '--blueprint' ) args.blueprint = argv[ ++ i ];
		else return null;

	}

	if ( ! args.parcel || ! args.out || ! [ 'merged', 'named' ].includes( args.glb ) ) return null;

	return args;

}

function listFiles( dir, prefix = '' ) {

	for ( const name of readdirSync( dir ).sort() ) {

		const path = join( dir, name );

		if ( statSync( path ).isDirectory() ) listFiles( path, `${prefix}${name}/` );
		else console.log( `${prefix}${name}  ${statSync( path ).size} bytes` );

	}

}

const args = parseArgs( process.argv.slice( 2 ) );

if ( ! args ) {

	console.error( 'usage: npm run assemble -- --parcel <id> --out <dir> [--blueprint <path>] [--glb merged|named] [--interior]' );
	process.exit( 2 );

}

const atlas = JSON.parse( readFileSync( resolve( args.blueprint ), 'utf8' ) );
const connections = await runConnections( atlas, { seed: atlas.meta.seed } );
const pipeline = new BuildingPipeline( new RequestAssembler( atlas, connections ) );
const outDir = resolve( args.out );

try {

	await pipeline.build( args.parcel, outDir, { glb: args.glb, interior: args.interior } );

} catch ( error ) {

	console.error( `${error.code ?? 'ERROR'}: ${error.message}` );
	process.exit( 1 );

}

listFiles( outDir );
