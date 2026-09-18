/** Assembles source-bound city artifacts and optional selected interiors through producer APIs. */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RequestAssembler, AssemblyError } from './RequestAssembler.js';
import { runConnections, runRooftopSpans } from './connectionsRunner.js';
import { BuildingPipeline } from './BuildingPipeline.js';
import { ExteriorWorkers } from './ExteriorWorkers.js';
import { StreetsAhead } from './StreetsAhead.js';
import { OutDir, MANIFEST_FILE } from './OutDir.js';
import { interiorPlan, parseCityArgs } from './CityPlan.js';
import { collectShellArtifacts } from './ShellArtifacts.js';
import { ConnectionsArtifact } from './ConnectionsArtifact.js';
import { loadBlueprint } from './BlueprintInput.js';
import { KitAssembler, KitManifest, blueprintFile } from './kit/index.js';
import { InteriorModules } from './InteriorModules.js';

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
const source = await loadBlueprint( args.blueprint );
if ( source.encoding !== 'json' ) throw new AssemblyError( 'E_STREETS_ARCHIVE_UNSUPPORTED', 'native city assembly requires an ordinary blueprint JSON input' );
const { atlas } = source;
const connections = await runConnections( atlas, { seed: atlas.meta.seed } );
const connectionsArtifact = new ConnectionsArtifact( atlas, connections );
const outDir = resolve( args.out );
const out = new OutDir( outDir );

const parcelIds = atlas.parcels.map( ( p ) => p.id );
const stale = out.prune( atlas.parcels );
const wanted = args.reuseShells ? [] : parcelIds.filter( ( id ) => ! args.parcels || args.parcels.includes( id ) );
const assembler = new RequestAssembler( atlas, connections );
// Without Exterior's published pieces every parcel is generated, so a machine
// that has not built the kit still assembles a city it can play; a world that
// already carries its own copy keeps building from it. A kit that is there but
// broken still ends the run.
const kit = KitManifest.find() ?? KitManifest.find( join( outDir, 'kit' ) );
const kitAssembler = kit ? new KitAssembler( atlas, assembler, kit ) : null;

const questlinesPath = join( outDir, 'quests', 'questlines.json' );
const questlines = existsSync( questlinesPath ) ? JSON.parse( readFileSync( questlinesPath, 'utf8' ) ) : [];
const planned = interiorPlan( atlas, questlines, parcelIds, args );

if ( planned.unknown.length ) {

	console.error( `E_INTERIOR_SELECTION: unknown: ${planned.unknown.join( ', ' )}` );
	process.exit( 1 );

}

// A building is furnished from its own blueprint, which both paths publish, so
// a parcel picked to open keeps whichever path it would take anyway.
const kitQueue = new Set( wanted.filter( ( id ) => kitAssembler?.candidate( id ) ) );
const queue = wanted.filter( ( id ) => ! kitQueue.has( id ) );
const workers = Math.max( 1, Math.min( args.workers, queue.length || 1 ) );
const streets = new StreetsAhead( outDir, atlas );
const exterior = new ExteriorWorkers( workers );
const pipeline = new BuildingPipeline( assembler, { exterior } );

console.log( args.reuseShells
	? `city ${atlas.meta.seed}: reusing ${parcelIds.length} shells`
	: `city ${atlas.meta.seed}: ${kitQueue.size} kit, ${queue.length} generated, ${workers} workers${exterior.governor.target ? `, held under ${exterior.governor.target} C` : ''}` );
if ( ! kit ) console.log( "no piece kit found: every building is generated (run Exterior's kit CLI to ship pieces instead)" );
if ( stale.length ) console.log( `dropped ${stale.length} folders this blueprint no longer has: ${stale.join( ', ' )}` );

const results = [];

async function worker() {

	for ( let id = queue.shift(); id; id = queue.shift() ) {

		const t0 = performance.now();
		const parcelDir = join( outDir, id );

		try {

			const { request } = await pipeline.build( id, parcelDir, { glb: 'merged', interior: false } );
			// This parcel is drawn from its own GLB now; a table from an earlier
			// kit run would name the pieces of the building it replaces.
			out.dropPlacements( id );
			const result = {
				parcelId: id,
				ok: true,
				source: 'shell',
				kitFallback: kitAssembler?.reasons.get( id ) ?? null,
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
				source: 'shell',
				error: `${error.code ?? 'ERROR'}: ${error.message}`,
				ms: Math.round( performance.now() - t0 )
			};
			results.push( result );
			console.log( `${id}  FAIL  ${result.error}` );

		}

	}

}

/** Kit buildings are cheap enough to place here while the workers generate shells. */
async function buildKitParcels() {

	for ( const id of kitQueue ) {

		const t0 = performance.now();
		const parcelDir = join( outDir, id );

		try {

			const table = kitAssembler.build( id, parcelDir );
			const result = {
				parcelId: id,
				ok: true,
				source: 'kit',
				family: table.family,
				floors: table.floors,
				basements: 0,
				interior: 'closed',
				sign: table.signText,
				ms: Math.round( performance.now() - t0 ),
				bytes: dirBytes( parcelDir )
			};
			results.push( result );
			console.log( `${id}  kit  ${table.family}  ${table.baysAcross}x${table.baysDeep} bays  ${result.floors}f  ${result.sign ? `"${result.sign}"  ` : ''}${result.ms} ms  ${result.bytes} bytes` );

		} catch ( error ) {

			out.drop( id );
			results.push( { parcelId: id, ok: false, source: 'kit', error: `${error.code ?? 'ERROR'}: ${error.message}`, ms: Math.round( performance.now() - t0 ) } );
			console.log( `${id}  FAIL  ${error.code ?? 'ERROR'}: ${error.message}` );

		}

		// Let the producer workers hand back their shells between buildings.
		await new Promise( ( resume ) => setImmediate( resume ) );

	}

}

const generating = Promise.all( Array.from( { length: workers }, worker ) );
await buildKitParcels();
await generating;

const shells = out.shells( parcelIds );

/** How each standing parcel is drawn, read from what its own folder holds. */
function classify( ids ) {

	const kits = out.kits( ids );
	const kitSet = new Set( kits );

	return { kits, sources: Object.fromEntries( ids.map( ( id ) => [ id, kitSet.has( id ) ? 'kit' : 'shell' ] ) ) };

}

// Any standing building can open, from its pieces or from its own GLB.
const { candidates, target: interiorTarget, unavailable: unavailableInteriors } = interiorPlan(
	atlas, questlines, shells, args
);

if ( unavailableInteriors.length ) {

	console.error( `E_INTERIOR_SELECTION: missing shell: ${unavailableInteriors.join( ', ' )}` );
	process.exit( 1 );

}

for ( const id of shells ) out.dropInterior( id );

if ( args.reuseShells ) {

	const complete = new Set( shells );
	const { sources: reused } = classify( parcelIds );

	for ( const parcelId of parcelIds ) {

		const ok = complete.has( parcelId );
		const made = reused[ parcelId ];
		results.push( ok ? {
			parcelId, ok: true, source: made, interior: 'closed', bytes: dirBytes( join( outDir, parcelId ) )
		} : {
			parcelId, ok: false, source: made, error: 'E_SHELL_MISSING: reusable city is missing its complete shell', ms: 0
		} );

	}

}

const readyInteriors = [];
const interiorFailures = [];
// One copy of the shared modules every furnished building draws, published on
// the first interior so a set that cannot be published keeps them all closed.
const modules = new InteriorModules();
const kitBuilt = new Set( out.kits( shells ) );

for ( const id of candidates ) {

	if ( readyInteriors.length >= interiorTarget ) break;

	const parcelDir = join( outDir, id );
	const blueprint = JSON.parse( readFileSync( join( parcelDir, blueprintFile( id ) ), 'utf8' ) );

	// Interior fills a ground, a middle and a crown layout, so a building
	// shorter than three floors has nothing to fill and is not a candidate.
	if ( blueprint.floors.filter( ( floor ) => floor.index >= 0 ).length < 3 ) {

		console.log( `${id}  interior  SKIP  fewer than three floors` );
		continue;

	}

	const t0 = performance.now();
	try {

		await modules.publish( outDir );
		const { request: refit, coreMode } = await pipeline.furnish( id, parcelDir, {
			blueprint, refit: ! kitBuilt.has( id )
		} );
		readyInteriors.push( id );
		const result = results.find( ( entry ) => entry.parcelId === id );
		if ( result ) Object.assign( result, {
			...( refit ? { floors: refit.building.floors, basements: refit.building.basements ?? 0 } : {} ),
			coreMode,
			interior: 'ready',
			bytes: dirBytes( parcelDir )
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

// Read once, after every building is final, so the report and the manifest
// name the same source for every parcel.
const { kits: kitParcels, sources } = classify( shells );
const generated = shells.filter( ( id ) => sources[ id ] === 'shell' );
// One copy of the pieces beside the world, so the folder plays on its own.
if ( kitParcels.length && ! kit ) throw new AssemblyError( 'E_KIT_MANIFEST', `${kitParcels.length} buildings stand from pieces but no kit is published` );
const kitReference = kitParcels.length ? kit.publish( outDir ) : null;
if ( kitReference ) console.log( `kit copied beside the world: ${kitParcels.length} buildings share ${kit.ids().length} families` );
const interiorResources = readyInteriors.length ? modules.references : null;
if ( interiorResources ) console.log( `interior modules and furniture copied beside the world: ${readyInteriors.length} furnished buildings share one set` );
for ( const result of results ) if ( sources[ result.parcelId ] ) result.source = sources[ result.parcelId ];

results.sort( ( a, b ) => a.parcelId.localeCompare( b.parcelId, undefined, { numeric: true } ) );

const failed = results.filter( ( r ) => ! r.ok );
const totals = {
	parcels: results.length,
	passed: results.length - failed.length,
	failed: failed.length,
	kit: kitParcels.length,
	generated: generated.length,
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

await exterior.close();
console.log( `reading ${shells.length} shell blueprints` );
const { catalog, rooftopRequest } = await collectShellArtifacts( outDir, shells, { seed: atlas.meta.seed } );
const rooftopSpans = await runRooftopSpans( rooftopRequest );
if ( out.carryTypes( source.path ) ) console.log( 'typed NPC set carried in beside the blueprint' );
const streetsPrepared = await streets.prepared();
console.log( `streets built in ${( streetsPrepared.ms / 1000 ).toFixed( 1 )} s alongside the shells` );
const manifest = await out.publishManifest( atlas, shells, readyInteriors, {
	rooftopSpans, connectionsArtifact, catalog, encoding: source.encoding, streets: true, streetsPrepared,
	kit: kitReference, interiorModules: interiorResources?.modules ?? null, interiorProps: interiorResources?.props ?? null, sources
} );
streets.dispose();

console.log( `\n${totals.passed}/${totals.parcels} buildings passed (${totals.kit} kit, ${totals.generated} generated), ${totals.failed} failed; ${totals.interiorsReady}/${totals.interiorsRequested} interiors ready; ${( totals.wallMs / 1000 ).toFixed( 1 )} s, ${( totals.bytes / 1e6 ).toFixed( 1 )} MB` );
for ( const r of failed ) console.log( `  ${r.parcelId}  ${r.error}` );
for ( const r of interiorFailures ) console.log( `  ${r.parcelId} interior kept closed  ${r.error}` );
if ( exterior.governor.summary() ) console.log( `heat: ${exterior.governor.summary()}` );
console.log( `qa report: ${join( outDir, 'qa-report.json' )}` );
const naming = manifest.named ? `, named${manifest.namingTheme ? `: ${manifest.namingTheme}` : ''}` : '';
console.log( `manifest: ${join( outDir, MANIFEST_FILE )} (${manifest.parcels.length} buildings, ${kitParcels.length} from the kit, ${manifest.interiors.length} interiors, ${manifest.rooftopSpans.spans.length} rooftop spans, atlas ${manifest.atlasVersion}${naming})` );

process.exit( failed.length > 0 || readyInteriors.length < interiorTarget ? 1 : 0 );
