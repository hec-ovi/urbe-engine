/**
 * npm run assemble-city -- --blueprint <path> --out <dir> [--workers N] [--interiors N] [--parcel <id,id,...>]
 *   [--reuse-shells true] [--interior-parcels <id,id,...>]
 * Full-city batch: connections once for the whole blueprint, then every shell
 * in parallel and a small deterministic quest/venue interior subset. Failures
 * are recorded in the QA report; an interior failure leaves its shell closed.
 *
 * The out dir ends holding exactly this blueprint: folders for parcels it no
 * longer has are removed first, and <dir>/manifest.json names the blueprint and
 * complete shells plus the explicit interior subset, which the game loads. Writes
 * <dir>/qa-report.json too and prints the summary. Exit 0 when every parcel
 * passed and the interior target is met, 1 otherwise.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RequestAssembler } from './RequestAssembler.js';
import { runConnections } from './connectionsRunner.js';
import { BuildingPipeline } from './BuildingPipeline.js';
import { OutDir, MANIFEST_FILE } from './OutDir.js';
import { interiorPlan, parseCityArgs } from './CityPlan.js';

function dirBytes( dir ) {

	let total = 0;

	for ( const name of readdirSync( dir ) ) {

		const path = join( dir, name );
		const stat = statSync( path );
		total += stat.isDirectory() ? dirBytes( path ) : stat.size;

	}

	return total;

}

const args = parseCityArgs( process.argv.slice( 2 ) );

if ( ! args ) {

	console.error( 'usage: npm run assemble-city -- --blueprint <path> --out <dir> [--workers N] [--interiors N] [--parcel <id,id,...>] [--reuse-shells true] [--interior-parcels <id,id,...>]' );
	process.exit( 2 );

}

const started = performance.now();
const atlas = JSON.parse( readFileSync( resolve( args.blueprint ), 'utf8' ) );
const connections = await runConnections( atlas, { seed: atlas.meta.seed } );
const pipeline = new BuildingPipeline( new RequestAssembler( atlas, connections ) );
const outDir = resolve( args.out );
const out = new OutDir( outDir );

const parcelIds = atlas.parcels.map( ( p ) => p.id );
const stale = out.prune( atlas.parcels );
const queue = args.reuseShells ? [] : parcelIds.filter( ( id ) => ! args.parcels || args.parcels.includes( id ) );

console.log( args.reuseShells
	? `city ${atlas.meta.seed}: reusing ${parcelIds.length} shells`
	: `city ${atlas.meta.seed}: ${queue.length} parcels, ${args.workers} workers` );
if ( stale.length ) console.log( `dropped ${stale.length} folders this blueprint no longer has: ${stale.join( ', ' )}` );

const results = [];

async function worker() {

	for ( let id = queue.shift(); id; id = queue.shift() ) {

		const t0 = performance.now();
		const parcelDir = join( outDir, id );

		try {

			const { request } = await pipeline.build( id, parcelDir, { glb: 'merged', interior: false } );
			const result = {
				parcelId: id,
				ok: true,
				floors: request.building.floors,
				basements: request.building.basements ?? 0,
				interior: 'closed',
				sign: request.options.signage?.text ?? null,
				ms: Math.round( performance.now() - t0 ),
				bytes: dirBytes( parcelDir )
			};
			results.push( result );
			console.log( `${id}  shell  ${result.floors}+${result.basements}b  ${result.sign ? `"${result.sign}"  ` : ''}${result.ms} ms  ${result.bytes} bytes` );

		} catch ( error ) {

			// A parcel that failed leaves nothing on disk, so the manifest and
			// the report agree on what the world actually holds.
			out.drop( id );

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

const shells = out.shells( parcelIds );

const questlinesPath = join( outDir, 'quests', 'questlines.json' );
const questlines = existsSync( questlinesPath ) ? JSON.parse( readFileSync( questlinesPath, 'utf8' ) ) : [];
const { candidates, target: interiorTarget, unknown: unknownInteriors, unavailable: unavailableInteriors } = interiorPlan(
	atlas, questlines, shells, args
);

if ( unknownInteriors.length || unavailableInteriors.length ) {

	const problem = [
		unknownInteriors.length ? `unknown: ${unknownInteriors.join( ', ' )}` : '',
		unavailableInteriors.length ? `missing shell: ${unavailableInteriors.join( ', ' )}` : ''
	].filter( Boolean ).join( '; ' );
	console.error( `E_INTERIOR_SELECTION: ${problem}` );
	process.exit( 1 );

}

for ( const id of shells ) out.dropInterior( id );

if ( args.reuseShells ) {

	const complete = new Set( shells );
	for ( const parcelId of parcelIds ) {

		const ok = complete.has( parcelId );
		results.push( ok ? {
			parcelId, ok: true, interior: 'closed', bytes: dirBytes( join( outDir, parcelId ) )
		} : {
			parcelId, ok: false, error: 'E_SHELL_MISSING: reusable city is missing its complete shell', ms: 0
		} );

	}

}

const readyInteriors = [];
const interiorFailures = [];

for ( const id of candidates ) {

	if ( readyInteriors.length >= interiorTarget ) break;

	const t0 = performance.now();
	try {

		const { request, coreMode } = await pipeline.build( id, join( outDir, id ), { glb: 'merged', interior: true } );
		readyInteriors.push( id );
		const result = results.find( ( entry ) => entry.parcelId === id );
		if ( result ) Object.assign( result, {
			floors: request.building.floors,
			basements: request.building.basements ?? 0,
			coreMode,
			interior: 'ready',
			bytes: dirBytes( join( outDir, id ) )
		} );
		console.log( `${id}  interior  ready  ${coreMode}  ${Math.round( performance.now() - t0 )} ms` );

	} catch ( error ) {

		out.dropInterior( id );
		const failure = { parcelId: id, error: `${error.code ?? 'ERROR'}: ${error.message}` };
		interiorFailures.push( failure );
		const result = results.find( ( entry ) => entry.parcelId === id );
		if ( result ) Object.assign( result, { interior: 'closed', interiorError: failure.error } );
		console.log( `${id}  interior  SKIP  ${failure.error}` );

	}

}

results.sort( ( a, b ) => a.parcelId.localeCompare( b.parcelId, undefined, { numeric: true } ) );

const failed = results.filter( ( r ) => ! r.ok );
const totals = {
	parcels: results.length,
	passed: results.length - failed.length,
	failed: failed.length,
	interiorsRequested: interiorTarget,
	interiorsReady: readyInteriors.length,
	interiorsFailed: interiorFailures.length,
	wallMs: Math.round( performance.now() - started ),
	bytes: results.reduce( ( sum, r ) => sum + ( r.bytes ?? 0 ), 0 )
};

writeFileSync( join( outDir, 'qa-report.json' ), JSON.stringify( {
	blueprint: resolve( args.blueprint ),
	seed: atlas.meta.seed,
	totals,
	parcels: results,
	interiorFailures
}, null, 2 ) + '\n' );

const manifest = out.writeManifest( atlas, shells, readyInteriors );
if ( out.carryTypes( resolve( args.blueprint ) ) ) console.log( 'typed NPC set carried in beside the blueprint' );

console.log( `\n${totals.passed}/${totals.parcels} shells passed, ${totals.failed} failed; ${totals.interiorsReady}/${totals.interiorsRequested} interiors ready; ${( totals.wallMs / 1000 ).toFixed( 1 )} s, ${( totals.bytes / 1e6 ).toFixed( 1 )} MB` );
for ( const r of failed ) console.log( `  ${r.parcelId}  ${r.error}` );
for ( const r of interiorFailures ) console.log( `  ${r.parcelId} interior kept closed  ${r.error}` );
console.log( `qa report: ${join( outDir, 'qa-report.json' )}` );
const naming = manifest.named ? `, named${manifest.namingTheme ? `: ${manifest.namingTheme}` : ''}` : '';
console.log( `manifest: ${join( outDir, MANIFEST_FILE )} (${manifest.parcels.length} shells, ${manifest.interiors.length} interiors, atlas ${manifest.atlasVersion}${naming})` );

process.exit( failed.length > 0 || readyInteriors.length < interiorTarget ? 1 : 0 );
