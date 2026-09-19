/** Assembles source-bound city artifacts and optional selected interiors through producer APIs. */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
import { KitAssembler, PlanLibrary, worldExteriorVersion } from './kit/index.js';
import { BuildingBlueprints } from './BuildingBlueprints.js';
import { InteriorModules } from './InteriorModules.js';
import { dirBytes } from './SharedResources.js';

const args = parseCityArgs( process.argv.slice( 2 ) );

if ( ! args ) {

	console.error( 'usage: npm run assemble-city -- --blueprint <path> --out <dir> [--workers N] [--interiors N] [--parcel <id,id,...>] [--reuse-shells true] [--interior-parcels <id,id,...>]' );
	process.exit( 2 );

}

const started = performance.now();
// Kit bands are 4.5 m each (Exterior kit contract).
const FLOOR_HEIGHT = 4.5;
const source = await loadBlueprint( args.blueprint );
if ( source.encoding !== 'json' ) throw new AssemblyError( 'E_STREETS_ARCHIVE_UNSUPPORTED', 'native city assembly requires an ordinary blueprint JSON input' );
const { atlas } = source;
// A first pass on the envelope heights gives the requests their apertures;
// the pass the world keeps runs once the kit has decided what stands where.
let connections = await runConnections( atlas, { seed: atlas.meta.seed } );
const outDir = resolve( args.out );
const out = new OutDir( outDir );

const parcelIds = atlas.parcels.map( ( p ) => p.id );
const stale = out.prune( atlas.parcels );
const wanted = args.reuseShells ? [] : parcelIds.filter( ( id ) => ! args.parcels || args.parcels.includes( id ) );
const assembler = new RequestAssembler( atlas, connections );
const exterior = new ExteriorWorkers( Math.max( 1, args.workers ) );
// A city is a hundred or so distinct buildings placed hundreds of times, so
// each one is generated once into the shared store and every parcel of it
// carries the frame it stands in. A reuse run stands on the plans this world
// was drawn with, whatever Exterior is installed now: their bytes are bound
// by the version that drew them.
const planLibrary = new PlanLibrary( {
	workers: exterior, version: ( args.reuseShells && worldExteriorVersion( outDir ) ) || undefined
} );
const kitAssembler = new KitAssembler( atlas, assembler, planLibrary );

const questlinesPath = join( outDir, 'quests', 'questlines.json' );
const questlines = existsSync( questlinesPath ) ? JSON.parse( readFileSync( questlinesPath, 'utf8' ) ) : [];
const planned = interiorPlan( atlas, questlines, parcelIds, args );

if ( planned.unknown.length ) {

	console.error( `E_INTERIOR_SELECTION: unknown: ${planned.unknown.join( ', ' )}` );
	process.exit( 1 );

}

// A building is furnished from its own blueprint, which both paths publish, so
// a parcel picked to open keeps whichever path it would take anyway. A lot a
// block's merge took over stands empty: its neighbour's building covers it.
// Only a neighbour the kit really takes gives it up, so a host the kit passes
// over, a landmark among them, leaves this lot its own building.
const merged = new Map( wanted.map( ( id ) => [ id, kitAssembler.absorbedBy( id ) ?? null ] )
	.filter( ( [ , host ] ) => host && kitAssembler.candidate( host ) ) );
const selected = new Set( wanted );
const kitQueue = new Set( wanted.filter( ( id ) => ! merged.has( id ) && kitAssembler.candidate( id ) ) );
const queue = wanted.filter( ( id ) => ! kitQueue.has( id ) && ! merged.has( id ) );
// Links stand on the roofs that will exist: a kit building's floors, a lot a
// merge emptied, nothing on the rest until the generator answers.
const roofs = {};
for ( const id of kitQueue ) roofs[ id ] = { roof: kitAssembler.candidate( id ).plan.floors * FLOOR_HEIGHT, stands: true };
for ( const id of merged.keys() ) roofs[ id ] = { roof: 0, stands: false };
connections = await runConnections( atlas, { seed: atlas.meta.seed, buildings: roofs } );
const connectionsArtifact = new ConnectionsArtifact( atlas, connections );
const workers = Math.max( 1, args.workers );
const streets = new StreetsAhead( outDir, atlas );
const pipeline = new BuildingPipeline( new RequestAssembler( atlas, connections ), { exterior } );

if ( stale.length ) console.log( `dropped ${stale.length} folders this blueprint no longer has: ${stale.join( ', ' )}` );

// Every distinct building first: a parcel cannot be written before the plan it
// stands from has a shell and a blueprint in the store.
const library = args.reuseShells || ! kitQueue.size
	? { drawn: 0, reused: 0, failed: 0, ms: 0 }
	: await planLibrary.draw();

for ( const id of [ ...kitQueue ] ) {

	const plan = kitAssembler.candidate( id ).plan.id;

	// A building Exterior could not draw sends its parcels back to the
	// generator, which builds each of them on its own lot.
	if ( planLibrary.blueprint( plan ) ) continue;

	kitQueue.delete( id );
	queue.push( id );
	kitAssembler.reasons.set( id, `plan ${plan}: ${planLibrary.failures.get( plan ) ?? 'was not drawn'}` );

	// This host now stands on its own lot only, so the lot its merge was going
	// to cover takes its own building back instead of shipping nothing.
	for ( const [ absorbed, host ] of merged ) {

		if ( host !== id ) continue;

		merged.delete( absorbed );
		queue.push( absorbed );
		kitAssembler.reasons.set( absorbed, `${id} stands no shared building over this lot` );

	}

}

console.log( args.reuseShells
	? `city ${atlas.meta.seed}: reusing ${parcelIds.length} shells`
	: `city ${atlas.meta.seed}: ${kitQueue.size} kit from ${planLibrary.size} plans `
		+ `(${library.drawn} drawn, ${library.reused} reused, ${library.failed} refused, ${( library.ms / 1000 ).toFixed( 1 )} s), `
		+ `${queue.length} generated, ${workers} workers${exterior.governor.target ? `, held under ${exterior.governor.target} C` : ''}` );

const results = [];
const parcelsById = new Map( atlas.parcels.map( ( parcel ) => [ parcel.id, parcel ] ) );

/**
 * A city never fails because one parcel failed. A parcel whose building could
 * not be made ships nothing and is published as the empty lot it is, with what
 * it was going to be, so the report says what the city is missing and where.
 */
function emptyLot( parcelId, error, ms = 0 ) {

	const parcel = parcelsById.get( parcelId );
	const xs = ( parcel?.lot ?? [] ).map( ( point ) => point[ 0 ] );
	const zs = ( parcel?.lot ?? [] ).map( ( point ) => point[ 1 ] );

	// Nothing on disk, so the manifest and the report agree on what stands.
	out.drop( parcelId );
	console.log( `${parcelId}  empty  ${error}` );

	return {
		parcelId,
		ok: false,
		source: 'empty',
		error,
		lot: xs.length ? { width: Math.max( ...xs ) - Math.min( ...xs ), depth: Math.max( ...zs ) - Math.min( ...zs ) } : null,
		type: parcel?.type ?? null,
		tier: parcel?.tier ?? null,
		floors: parcel?.envelope?.maxFloors ?? null,
		ms
	};

}

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

			results.push( emptyLot( id, `${error.code ?? 'ERROR'}: ${error.message}`, Math.round( performance.now() - t0 ) ) );

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
				family: table.family ?? null,
				floors: table.floors,
				basements: 0,
				interior: 'closed',
				sign: table.signText,
				ms: Math.round( performance.now() - t0 ),
				bytes: dirBytes( parcelDir )
			};
			results.push( result );
			console.log( `${id}  kit  ${table.plan}${table.absorbs ? ` over ${table.absorbs}` : ''}  ${result.sign ? `"${result.sign}"  ` : ''}${result.ms} ms  ${result.bytes} bytes` );

		} catch ( error ) {

			results.push( emptyLot( id, `${error.code ?? 'ERROR'}: ${error.message}`, Math.round( performance.now() - t0 ) ) );

		}

		// Let the producer workers hand back their shells between buildings.
		await new Promise( ( resume ) => setImmediate( resume ) );

	}

}

const generating = Promise.all( Array.from( { length: workers }, worker ) );
await buildKitParcels();
await generating;

// A lot a block's variation merged into its neighbour is empty on purpose, but
// only while that neighbour stands. A host whose building failed leaves this
// lot its own generated shell, so one failure never costs two lots.
const built = new Set( results.filter( ( result ) => result.ok ).map( ( result ) => result.parcelId ) );
const orphaned = new Map();

for ( const [ id, host ] of merged ) {

	// A host this run did not build keeps whatever its folder already holds.
	if ( built.has( host ) || ! selected.has( host ) ) {

		out.drop( id );
		results.push( { parcelId: id, ok: true, source: 'empty', mergedInto: host, ms: 0, bytes: 0 } );

	} else {

		orphaned.set( id, host );
		queue.push( id );

	}

}

if ( orphaned.size ) {

	await Promise.all( Array.from( { length: Math.min( workers, queue.length ) }, worker ) );

	for ( const [ id, host ] of orphaned ) {

		const result = results.find( ( entry ) => entry.parcelId === id );

		if ( result?.ok ) result.kitFallback = `${host} stands no building over this lot`;

	}

}

const shells = out.shells( parcelIds );
// A kit building's blueprint is its plan's, turned into the frame the parcel
// stands in, so the plans are bound before anything reads a blueprint.
const kitParcels = out.kits( shells );
const kitPlans = kitParcels.length ? out.kitPlans( kitParcels ) : new Map();
const plans = [ ...new Set( kitPlans.values() ) ].sort();
const kitReference = plans.length ? planLibrary.publish( plans ) : null;
const planBytes = plans.length ? planLibrary.bytes( plans ) : 0;
const blueprints = new BuildingBlueprints( outDir, planLibrary );

/** How each parcel is drawn, read from what its own folder holds. */
function classify( ids ) {

	const kits = out.kits( ids );
	const kitSet = new Set( kits );
	const standing = new Set( ids );

	return {
		kits,
		sources: Object.fromEntries( parcelIds
			.filter( ( id ) => standing.has( id ) || ! args.parcels )
			.map( ( id ) => [ id, standing.has( id ) ? ( kitSet.has( id ) ? 'kit' : 'shell' ) : 'empty' ] ) )
	};

}

// Any standing building can open, from its pieces or from its own GLB.
const { candidates, target: interiorTarget, unavailable: unavailableInteriors } = interiorPlan(
	atlas, questlines, shells, args
);

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
// A manual selection can name a lot with no building on it. The city stands
// either way, so that one is reported and the rest of the selection opens.
const interiorFailures = unavailableInteriors.map( ( id ) => ( {
	parcelId: id, error: 'E_INTERIOR_SELECTION: no building stands on this parcel'
} ) );

for ( const failure of interiorFailures ) console.log( `${failure.parcelId}  interior  SKIP  ${failure.error}` );

// One copy of the shared modules every furnished building draws, published on
// the first interior so a set that cannot be published keeps them all closed.
const modules = new InteriorModules();
const kitBuilt = new Set( kitParcels );

for ( const id of candidates ) {

	if ( readyInteriors.length >= interiorTarget ) break;

	const parcelDir = join( outDir, id );
	const blueprint = await blueprints.of( id );

	// Interior fills a ground, a middle and a crown layout, so a building
	// shorter than three floors has nothing to fill and is not a candidate.
	if ( blueprint.floors.filter( ( floor ) => floor.index >= 0 ).length < 3 ) {

		console.log( `${id}  interior  SKIP  fewer than three floors` );
		continue;

	}

	const t0 = performance.now();
	try {

		await modules.publish();
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
const { sources } = classify( shells );
const generated = shells.filter( ( id ) => sources[ id ] === 'shell' );
// What each standing building is: the block template that dressed it and the
// plan it stands from, whose blueprint is where its own is composed from.
const buildings = Object.fromEntries( [ ...kitPlans ].map( ( [ id, plan ] ) => [ id, {
	template: kitAssembler.templates.slotOf.get( id )?.templateId ?? null,
	slot: kitAssembler.templates.slotOf.get( id )?.slot ?? null,
	plan
} ] ) );
if ( kitReference ) console.log( `${kitParcels.length} buildings stand from ${plans.length} shared plans, ${( planBytes / 1e6 ).toFixed( 1 )} MB` );
const interiorResources = readyInteriors.length ? modules.references : null;
if ( interiorResources ) console.log( `${readyInteriors.length} furnished buildings share one interior module and furniture set` );
for ( const result of results ) {

	if ( sources[ result.parcelId ] ) result.source = sources[ result.parcelId ];
	if ( buildings[ result.parcelId ] ) Object.assign( result, buildings[ result.parcelId ] );

}

results.sort( ( a, b ) => a.parcelId.localeCompare( b.parcelId, undefined, { numeric: true } ) );

const failed = results.filter( ( r ) => ! r.ok );
const empty = results.filter( ( r ) => r.source === 'empty' );
const totals = {
	parcels: results.length,
	passed: results.length - failed.length,
	failed: failed.length,
	kit: kitParcels.length,
	generated: generated.length,
	empty: empty.length,
	plans: plans.length,
	planBytes,
	planMs: library.ms,
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
	plans,
	parcels: results,
	interiorFailures
}, null, 2 ) + '\n' );

await exterior.close();
console.log( `reading ${shells.length} shell blueprints` );
const { catalog, rooftopRequest } = await collectShellArtifacts( outDir, shells, { seed: atlas.meta.seed, plans: planLibrary } );
const rooftopSpans = await runRooftopSpans( rooftopRequest );
if ( out.carryTypes( source.path ) ) console.log( 'typed NPC set carried in beside the blueprint' );
const streetsPrepared = await streets.prepared();
console.log( `streets built in ${( streetsPrepared.ms / 1000 ).toFixed( 1 )} s alongside the shells` );
const manifest = await out.publishManifest( atlas, shells, readyInteriors, {
	rooftopSpans, connectionsArtifact, catalog, encoding: source.encoding, streets: true, streetsPrepared,
	kit: kitReference, interiorModules: interiorResources?.modules ?? null, interiorProps: interiorResources?.props ?? null,
	sources, buildings: kitParcels.length ? buildings : null
} );
streets.dispose();

console.log( `\n${totals.passed}/${totals.parcels} buildings passed (${totals.kit} kit from ${totals.plans} plans, ${totals.generated} generated), ${totals.empty} empty lots; ${totals.interiorsReady}/${totals.interiorsRequested} interiors ready; ${( totals.wallMs / 1000 ).toFixed( 1 )} s, ${( totals.bytes / 1e6 ).toFixed( 1 )} MB in the world and ${( totals.planBytes / 1e6 ).toFixed( 1 )} MB of shared plans` );
for ( const r of failed ) console.log( `  ${r.parcelId}  ${r.error}` );
for ( const r of interiorFailures ) console.log( `  ${r.parcelId} interior kept closed  ${r.error}` );
if ( exterior.governor.summary() ) console.log( `heat: ${exterior.governor.summary()}` );
console.log( `qa report: ${join( outDir, 'qa-report.json' )}` );
const naming = manifest.named ? `, named${manifest.namingTheme ? `: ${manifest.namingTheme}` : ''}` : '';
console.log( `manifest: ${join( outDir, MANIFEST_FILE )} (${manifest.parcels.length} buildings, ${kitParcels.length} from the kit, ${manifest.interiors.length} interiors, ${manifest.rooftopSpans.spans.length} rooftop spans, atlas ${manifest.atlasVersion}${naming})` );

// The batch stands: every set this world names is bound by the manifest, so
// what the store holds beyond the worlds on disk is last night's rebuilds.

// The manifest is published: the city stands, whatever single lots it is missing.
process.exit( 0 );
