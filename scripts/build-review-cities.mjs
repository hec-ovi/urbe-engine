#!/usr/bin/env -S node --import tsx
/** Deterministic review worlds using native Atlas land and normal producer APIs.
 * Usage: node --import tsx scripts/build-review-cities.mjs four|gallery [--plan-only]
 *        [--blueprint path] [--out name]
 * Existing outputs are never replaced. Choose a new --out after producer edits.
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { basename, join, resolve } from 'node:path';
import { BuildingPipeline } from '../src/assembly/BuildingPipeline.js';
import { ExteriorWorkers } from '../src/assembly/ExteriorWorkers.js';
import { InteriorModules } from '../src/assembly/InteriorModules.js';
import { OutDir } from '../src/assembly/OutDir.js';
import { StandingBuildings } from '../src/assembly/StandingBuildings.js';
import { ConnectionsArtifact } from '../src/assembly/ConnectionsArtifact.js';
import { collectShellArtifacts } from '../src/assembly/ShellArtifacts.js';
import { runConnections, runRooftopSpans } from '../src/assembly/connectionsRunner.js';
import { validateExteriorRequest } from '../src/assembly/validators.js';
import { annotateReview } from './review-report.mjs';

const engineRoot = fileURLToPath( new URL( '..', import.meta.url ) );
const args = process.argv.slice( 2 );
const kind = args.shift();
if ( ! [ 'four', 'gallery' ].includes( kind ) ) throw new Error( 'Choose four or gallery.' );
const options = { blueprint: join( engineRoot, 'out/cities/small-city-5e56c399/blueprint.json' ), out: `${kind}-buildings`, planOnly: false };
while ( args.length ) {
	const flag = args.shift();
	if ( flag === '--plan-only' ) options.planOnly = true;
	else if ( flag === '--blueprint' && args.length ) options.blueprint = resolve( args.shift() );
	else if ( flag === '--out' && args.length ) options.out = args.shift();
	else throw new Error( `Unknown or incomplete option: ${flag}` );
}
if ( ! /^[a-z0-9][a-z0-9._-]*$/.test( options.out ) || basename( options.out ) !== options.out ) throw new Error( 'Output must be one safe folder name.' );
process.env.URBE_ASSEMBLY_WORKERS = '4';
process.env.URBE_ASSEMBLY_MAX_TEMP = '88';
const atlas = JSON.parse( await readFile( options.blueprint, 'utf8' ) );
const root = join( engineRoot, 'out/reviews' );
const target = join( root, options.out );
if ( existsSync( target ) ) throw new Error( `Output exists: ${target}. Choose a new --out; existing review worlds are preserved.` );

const balcony = {
	architecture: 'balcony-grid', width: 20.5, depth: 37.5, floors: 7,
	type: 'corpo', tier: 'high_rich', entrance: 'west',
	seed: 'plans:balcony-grid-commercial-high_rich-5x3x33f'
};
// These sizes are supported by each producer family's published host fixtures.
// The known 20 × 37 preview label refers to its exact 20.5 × 37.5 m request.
const fixtures = kind === 'four' ? [ 0, 1, 2, 3 ].map( quarter => ( { ...balcony, quarter } ) ) : [
	{ architecture: 'garden-taper', width: 52, depth: 42, floors: 4, type: 'residential', seed: 'garden-reference' },
	{ architecture: 'corporate-sectors', width: 40, depth: 40, floors: 12, type: 'corpo', seed: 'corporate-contract' },
	balcony,
	...[
		[ 'faceted-bays', 'faceted-bays-reference' ], [ 'mirror-frame', 'portal-pier-reference' ],
		[ 'mirror-shutters', 'mirror-shutters-reference' ], [ 'white-grid', 'white-grid-reference' ]
	].map( ( [ architecture, seed ] ) => ( { architecture, seed, width: 32, depth: 24, floors: 8, type: 'offices' } ) )
];
const used = new Set();
const selection = fixtures.map( fixture => select( atlas, fixture, used ) );
const requests = new Map( selection.map( entry => [ entry.parcelId, entry.request ] ) );
const report = {
	format: 'urbe-building-review-v1', kind, source: options.blueprint, seed: atlas.meta.seed,
	buildings: selection.map( ( { request, ...entry } ) => entry ),
	playUrl: `http://localhost:5306/?mode=game&out=/out/reviews/${options.out}&hour=12`,
	// The Atlas preview includes its planned massing on deliberately empty lots.
	// The game link above shows only the four or seven buildings actually built.
	landPlanUrl: `http://localhost:5306/?mode=city&out=/out/reviews/${options.out}`
};
console.log( JSON.stringify( report, null, 2 ) );
if ( options.planOnly ) process.exit( 0 );
await mkdir( root, { recursive: true } );
const staged = await mkdtemp( join( root, `.${options.out}-` ) );
const exterior = new ExteriorWorkers( 4 );
try {
	// The adapter supplies explicit valid producer requests; the pipeline retains
	// its normal validation, generation, core gate and interior publication.
	const pipeline = new BuildingPipeline( {
		assemble: id => structuredClone( requests.get( id ) ),
		assembleInterior: ( id, { blueprint, shellGlb } ) => {
			const request = requests.get( id );
			return { seed: request.seed, building: { id, type: request.building.type, tier: request.building.tier },
				blueprint, materialTheme: request.theme, ...( shellGlb ? { shellGlb } : {} ) };
		}
	}, { exterior } );
	const standing = new StandingBuildings();
	const built = [];
	for ( const parcel of atlas.parcels ) standing.empty( parcel.id );
	// One interior at a time keeps peak geometry/module memory bounded; Exterior
	// has its normal four-worker, 88 C ceiling and does not spawn CLI subtrees.
	for ( const entry of selection ) {
		const { blueprint } = await pipeline.build( entry.parcelId, join( staged, entry.parcelId ), { interior: true } );
		if ( blueprint.floors.filter( floor => floor.index >= 0 ).length !== entry.floors ) throw new Error( `Producer changed requested floor count: ${entry.parcelId}` );
		standing.place( entry.parcelId, blueprint.bounds.footprint, blueprint.roof.elevation );
		built.push( { entry, blueprint } );
		console.log( `Built ${entry.architecture}: ${entry.parcelId}, ${entry.rotationDegrees} degrees, ${entry.floors} floors` );
	}
	if ( kind === 'four' ) verifyCopies( built );
	const ids = selection.map( entry => entry.parcelId );
	// Standalone review requests have no interbuilding cut reservations. Use the
	// Connections public toggles so no later bridge/tunnel can meet an uncut wall.
	const connections = await runConnections( standing.atlas( atlas ), {
		seed: atlas.meta.seed, buildings: standing.roofs,
		toggles: { bridges: false, acTubes: false, tunnels: false, wires: false }
	} );
	const resources = await new InteriorModules().publish();
	const { catalog, rooftopRequest } = await collectShellArtifacts( staged, ids, { seed: atlas.meta.seed } );
	const rooftopSpans = await runRooftopSpans( rooftopRequest );
	const sources = Object.fromEntries( atlas.parcels.map( parcel => [ parcel.id, used.has( parcel.id ) ? 'shell' : 'empty' ] ) );
	const out = new OutDir( staged );
	await out.publishManifest( atlas, ids, ids, {
		catalog, rooftopSpans, connectionsArtifact: new ConnectionsArtifact( atlas, connections ), sources,
		interiorModules: resources.modules, interiorProps: resources.props, streets: true
	} );
	await writeFile( join( staged, 'review.json' ), JSON.stringify( report, null, 2 ) + '\n' );
	await annotateReview( staged );
	await rename( staged, target );
	console.log( `Published ${report.playUrl}` );
} finally {
	await exterior.close();
	await rm( staged, { recursive: true, force: true } );
}

function select( city, fixture, occupied ) {
	const center = city.meta.bounds.min.map( ( v, i ) => ( v + city.meta.bounds.max[ i ] ) / 2 );
	const candidates = [];
	for ( const parcel of city.parcels ) {
		if ( occupied.has( parcel.id ) || ! parcel.envelope || parcel.envelope.maxFloors < fixture.floors ) continue;
		const bounds = box( parcel.lot );
		const face = entranceFace( city, parcel, bounds );
		for ( const quarter of fixture.quarter === undefined ? [ 0, 1, 2, 3 ] : [ fixture.quarter ] ) {
			const local = [ [ 0, 0 ], [ fixture.width, 0 ], [ fixture.width, fixture.depth ], [ 0, fixture.depth ] ];
			const rotated = local.map( point => turn( point, quarter ) );
			const sourceBox = box( rotated );
			const normal = turn( fixture.entrance === 'west' ? [ -1, 0 ] : [ 0, -1 ], quarter );
			if ( normal[ 0 ] !== face[ 0 ] || normal[ 1 ] !== face[ 1 ] ) continue;
			const width = sourceBox.max[ 0 ] - sourceBox.min[ 0 ], depth = sourceBox.max[ 1 ] - sourceBox.min[ 1 ];
			if ( width > bounds.max[ 0 ] - bounds.min[ 0 ] - 1 || depth > bounds.max[ 1 ] - bounds.min[ 1 ] - 1 ) continue;
			const min = [ width, depth ].map( ( size, i ) => normal[ i ] < 0
				? Math.ceil( ( bounds.min[ i ] + 0.5 ) * 2 ) / 2
				: normal[ i ] > 0 ? Math.floor( ( bounds.max[ i ] - size - 0.5 ) * 2 ) / 2
					: Math.ceil( ( ( bounds.min[ i ] + bounds.max[ i ] - size ) / 2 ) * 2 ) / 2 );
			if ( min.some( ( v, i ) => v + [ width, depth ][ i ] > bounds.max[ i ] - 0.25 ) ) continue;
			const origin = min.map( ( v, i ) => v - sourceBox.min[ i ] );
			const move = point => turn( point, quarter ).map( ( v, i ) => v + origin[ i ] );
			const accessPoint = move( fixture.entrance === 'west' ? [ 0, fixture.depth / 2 ] : [ fixture.width / 2, 0 ] );
			const request = {
				seed: fixture.seed, buildingId: parcel.id,
				parcel: { footprint: local.map( move ), accessPoint, maxHeight: parcel.envelope.maxHeight,
					buildingGrid: { origin, angle: -quarter * Math.PI / 2, spacing: city.meta.buildingGrid?.spacing ?? 0.5 }, streetAccess: { edgeId: parcel.access.edgeId,
						path: city.streets.edges.find( edge => edge.id === parcel.access.edgeId ).path } },
				building: { type: fixture.type, tier: fixture.tier ?? 'rich', floors: fixture.floors }, theme: 'cyberpunk',
				options: { architecture: fixture.architecture, glb: 'merged' }
			};
			const errors = validateExteriorRequest( request );
			if ( errors.length ) throw new Error( JSON.stringify( errors ) );
			const distance = min.reduce( ( sum, value, i ) => sum + ( value - center[ i ] ) ** 2, 0 );
			candidates.push( { parcelId: parcel.id, architecture: fixture.architecture, width: fixture.width,
				depth: fixture.depth, floors: fixture.floors, rotationDegrees: quarter * 90, accessPoint, request,
				distance } );
		}
	}
	candidates.sort( ( a, b ) => a.distance - b.distance || a.parcelId.localeCompare( b.parcelId, undefined, { numeric: true } ) );
	const selected = candidates[ 0 ];
	if ( ! selected ) throw new Error( `No street-facing lot fits ${fixture.architecture} ${fixture.width}x${fixture.depth}x${fixture.floors} at ${fixture.quarter ?? 'any'} quarter turn.` );
	occupied.add( selected.parcelId );
	delete selected.distance;
	return selected;
}

function box( ring ) {
	return { min: [ 0, 1 ].map( i => Math.min( ...ring.map( p => p[ i ] ) ) ), max: [ 0, 1 ].map( i => Math.max( ...ring.map( p => p[ i ] ) ) ) };
}

function entranceFace( city, parcel, bounds ) {
	// Match assembly's street-facing convention using the named source path,
	// including parcels whose access point lies at a corner.
	const path = city.streets.edges.find( edge => edge.id === parcel.access.edgeId ).path;
	const faces = [ [ -1, 0 ], [ 0, -1 ], [ 1, 0 ], [ 0, 1 ] ];
	return faces.sort( ( a, b ) => distance( a ) - distance( b ) )[ 0 ];
	function distance( normal ) {
		const middle = normal.map( ( value, i ) => value < 0 ? bounds.min[ i ] : value > 0 ? bounds.max[ i ] : ( bounds.min[ i ] + bounds.max[ i ] ) / 2 );
		return Math.min( ...path.slice( 1 ).map( ( b, index ) => {
			const a = path[ index ], delta = b.map( ( v, i ) => v - a[ i ] );
			const square = delta.reduce( ( sum, v ) => sum + v * v, 0 );
			const t = Math.max( 0, Math.min( 1, delta.reduce( ( sum, v, i ) => sum + v * ( middle[ i ] - a[ i ] ), 0 ) / square ) );
			return middle.reduce( ( sum, v, i ) => sum + ( v - a[ i ] - delta[ i ] * t ) ** 2, 0 );
		} ) );
	}
}

function turn( [ x, z ], quarter ) {
	return [ [ x, z ], [ z, -x ], [ -x, -z ], [ -z, x ] ][ quarter ];
}

function verifyCopies( built ) {
	const normalized = built.map( ( { entry, blueprint } ) => {
		const frame = entry.request.parcel.buildingGrid;
		const inverse = point => turn( point.map( ( value, i ) => value - frame.origin[ i ] ), ( 4 - entry.rotationDegrees / 90 ) % 4 );
		const ring = points => points.map( inverse ).map( point => point.map( value => Math.round( value * 1e6 ) / 1e6 ) )
			.sort( ( a, b ) => a[ 0 ] - b[ 0 ] || a[ 1 ] - b[ 1 ] );
		return JSON.stringify( blueprint.floors.filter( floor => floor.index >= 0 ).map( floor => ( {
			index: floor.index, elevation: floor.elevation, height: floor.height,
			outline: ring( floor.outline ), ...( floor.topOutline ? { topOutline: ring( floor.topOutline ) } : {} )
		} ) ) );
	} );
	if ( normalized.some( value => value !== normalized[ 0 ] ) ) throw new Error( 'Four-copy verification failed: source floor geometry differs after undoing the requested translations and quarter turns.' );
}
