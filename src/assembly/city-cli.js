/**
 * npm run assemble-city -- --blueprint <path> --out <dir> [--workers N] [--parcel <id,id,...>]
 * Full-city batch: connections once for the whole blueprint, then the building
 * pipeline (merged runtime GLB, blueprint, core-gated interior with npc.json)
 * for every parcel, a few in parallel. Failures are recorded in the QA report,
 * never fatal; the run always completes. Writes <dir>/qa-report.json and
 * prints the summary. Exit 0 when every parcel passed, 1 otherwise.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RequestAssembler } from './RequestAssembler.js';
import { runConnections } from './connectionsRunner.js';
import { BuildingPipeline } from './BuildingPipeline.js';

function parseArgs( argv ) {

	const args = { workers: 4, parcels: null };

	for ( let i = 0; i < argv.length; i += 2 ) {

		const key = argv[ i ];
		const value = argv[ i + 1 ];

		if ( key === '--blueprint' ) args.blueprint = value;
		else if ( key === '--out' ) args.out = value;
		else if ( key === '--workers' ) args.workers = parseInt( value, 10 );
		else if ( key === '--parcel' ) args.parcels = value.split( ',' );
		else return null;

	}

	if ( ! args.blueprint || ! args.out || ! ( args.workers >= 1 ) ) return null;

	return args;

}

function dirBytes( dir ) {

	let total = 0;

	for ( const name of readdirSync( dir ) ) {

		const path = join( dir, name );
		const stat = statSync( path );
		total += stat.isDirectory() ? dirBytes( path ) : stat.size;

	}

	return total;

}

const args = parseArgs( process.argv.slice( 2 ) );

if ( ! args ) {

	console.error( 'usage: npm run assemble-city -- --blueprint <path> --out <dir> [--workers N] [--parcel <id,id,...>]' );
	process.exit( 2 );

}

const started = performance.now();
const atlas = JSON.parse( readFileSync( resolve( args.blueprint ), 'utf8' ) );
const connections = await runConnections( atlas, { seed: atlas.meta.seed } );
const pipeline = new BuildingPipeline( new RequestAssembler( atlas, connections ) );
const outDir = resolve( args.out );

const queue = atlas.parcels
	.map( ( p ) => p.id )
	.filter( ( id ) => ! args.parcels || args.parcels.includes( id ) );
console.log( `city ${atlas.meta.seed}: ${queue.length} parcels, ${args.workers} workers` );

const results = [];

async function worker() {

	for ( let id = queue.shift(); id; id = queue.shift() ) {

		const t0 = performance.now();
		const parcelDir = join( outDir, id );

		try {

			const { request, coreMode } = await pipeline.build( id, parcelDir, { glb: 'merged', interior: true } );
			const result = {
				parcelId: id,
				ok: true,
				floors: request.building.floors,
				basements: request.building.basements ?? 0,
				coreMode,
				ms: Math.round( performance.now() - t0 ),
				bytes: dirBytes( parcelDir )
			};
			results.push( result );
			console.log( `${id}  ok  ${result.floors}+${result.basements}b ${coreMode}  ${result.ms} ms  ${result.bytes} bytes` );

		} catch ( error ) {

			const result = {
				parcelId: id,
				ok: false,
				error: `${error.code ?? 'ERROR'}: ${error.message}`,
				ms: Math.round( performance.now() - t0 )
			};
			results.push( result );
			console.log( `${id}  FAIL  ${result.error}` );

		}

	}

}

await Promise.all( Array.from( { length: args.workers }, worker ) );

results.sort( ( a, b ) => a.parcelId.localeCompare( b.parcelId, undefined, { numeric: true } ) );

const failed = results.filter( ( r ) => ! r.ok );
const totals = {
	parcels: results.length,
	passed: results.length - failed.length,
	failed: failed.length,
	wallMs: Math.round( performance.now() - started ),
	bytes: results.reduce( ( sum, r ) => sum + ( r.bytes ?? 0 ), 0 )
};

writeFileSync( join( outDir, 'qa-report.json' ), JSON.stringify( {
	blueprint: resolve( args.blueprint ),
	seed: atlas.meta.seed,
	totals,
	parcels: results
}, null, 2 ) + '\n' );

console.log( `\n${totals.passed}/${totals.parcels} passed, ${totals.failed} failed, ${( totals.wallMs / 1000 ).toFixed( 1 )} s, ${( totals.bytes / 1e6 ).toFixed( 1 )} MB` );
for ( const r of failed ) console.log( `  ${r.parcelId}  ${r.error}` );
console.log( `qa report: ${join( outDir, 'qa-report.json' )}` );

process.exit( failed.length > 0 ? 1 : 0 );
