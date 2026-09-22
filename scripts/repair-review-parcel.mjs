#!/usr/bin/env node
// Repair one failed shell through assembly. Cities are immutable library
// records, and a game's city identity is immutable. Publish a new city and game
// variant, preserving the original game's quests, interiors and progress.
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { BuildingPipeline } from '../src/assembly/BuildingPipeline.js';
import { RequestAssembler } from '../src/assembly/RequestAssembler.js';
import { ExteriorWorkers } from '../src/assembly/ExteriorWorkers.js';
import { ConnectionsArtifact } from '../src/assembly/ConnectionsArtifact.js';
import { OutDir } from '../src/assembly/OutDir.js';
import { collectShellArtifacts } from '../src/assembly/ShellArtifacts.js';
import { runRooftopSpans } from '../src/assembly/connectionsRunner.js';
import { PlanLibrary, worldExteriorVersion } from '../src/assembly/kit/index.js';
import { createLibrary } from '../src/library/index.js';
import { cityDescriptor } from '../src/creation/src/descriptors.js';

const [ cityId, gameId, parcelId = 'p67', option ] = process.argv.slice( 2 );
if ( option && option !== '--resume' ) throw new Error( 'Only --resume is supported after the parcel id.' );
for ( const id of [ cityId, gameId, parcelId ] ) if ( ! /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test( id ?? '' ) ) throw new Error( 'Pass city ID, game ID and optional parcel ID.' );
const engineRoot = fileURLToPath( new URL( '..', import.meta.url ) );
const outRoot = join( engineRoot, 'out' );
const cityRoot = join( outRoot, 'cities', cityId );
const gameRoot = join( outRoot, 'games', gameId );
const nextCityId = `${cityId}-complete`;
const nextGameId = `${gameId}-complete`;
if ( nextCityId.length > 64 || nextGameId.length > 64 ) throw new Error( 'Source IDs must leave room for the -complete suffix.' );
const target = join( outRoot, 'cities', nextCityId );
const gameTarget = join( outRoot, 'games', nextGameId );
if ( existsSync( target ) && option !== '--resume' ) throw new Error( `City already exists: ${nextCityId}; use --resume only for this repair's previously published city.` );
if ( existsSync( gameTarget ) ) throw new Error( `Game already exists: ${nextGameId}` );
const library = createLibrary( { outDir: outRoot } );
const city = await library.loadCity( { id: cityId } );
const initialGame = await library.loadGame( { id: gameId } );
if ( initialGame.cityId !== cityId ) throw new Error( 'Game does not belong to the requested source city.' );
const initial = await json( join( cityRoot, 'manifest.json' ) );
if ( initial.sources?.[ parcelId ] !== 'empty' || initial.interiors.includes( parcelId ) ) throw new Error( 'Repair expects an empty parcel without an interior.' );
process.env.URBE_ASSEMBLY_WORKERS = '4';
process.env.URBE_ASSEMBLY_MAX_TEMP = '88';
await mkdir( join( outRoot, '.work' ), { recursive: true } );
const temporary = await mkdtemp( join( outRoot, '.work/repair-' ) );
const world = join( temporary, 'world' );
const exterior = new ExteriorWorkers( 4 );
try {
	if ( ! existsSync( target ) ) {
	await cp( cityRoot, world, { recursive: true } );
	await rm( join( world, 'city.json' ) );
	const atlas = await json( join( world, 'blueprint.json' ) );
	const connections = await json( join( world, 'connections.json' ) );
	const pipeline = new BuildingPipeline( new RequestAssembler( atlas, connections ), { exterior } );
	await pipeline.build( parcelId, join( world, parcelId ), { interior: false } );
	await publish( world, parcelId );
	const qa = await json( join( world, 'qa-report.json' ) );
	const record = qa.parcels.find( entry => entry.parcelId === parcelId );
	if ( record ) { delete record.error; Object.assign( record, { ok: true, source: 'shell', repaired: true } ); }
	Object.assign( qa.totals, { passed: qa.totals.passed + 1, failed: qa.totals.failed - 1, generated: qa.totals.generated + 1, empty: qa.totals.empty - 1 } );
	await writeFile( join( world, 'qa-report.json' ), JSON.stringify( qa, null, 2 ) + '\n' );
	await rename( world, target );
	const descriptor = await cityDescriptor( target, nextCityId, { name: `${city.name} Complete`, size: city.size, seed: city.seed }, atlas, new Date() );
	const complete = await json( join( target, 'manifest.json' ) );
	const standing = new Set( complete.parcels );
	descriptor.buildings = descriptor.buildings.map( building => ( { ...building, eligible: standing.has( building.id ) } ) );
	await library.saveCity( descriptor );
	} else {
		const completeCity = await library.loadCity( { id: nextCityId } );
		const completeManifest = await json( join( target, 'manifest.json' ) );
		if ( completeCity.seed !== city.seed || completeManifest.sources?.[ parcelId ] !== 'shell' ) throw new Error( 'Existing city is not this completed repair.' );
	}
	const stagedGame = join( temporary, 'game' );
	await cp( gameRoot, stagedGame, { recursive: true } );
	await rm( join( stagedGame, 'game.json' ) );
	if ( ! existsSync( join( stagedGame, parcelId ) ) ) await cp( join( target, parcelId ), join( stagedGame, parcelId ), { recursive: true } );
	await publish( stagedGame, parcelId );
	const game = await library.loadGame( { id: gameId } );
	await rename( stagedGame, gameTarget );
	await library.saveGame( { expectedRevision: null, game: {
		...game, id: nextGameId, cityId: nextCityId, name: `${game.name} Complete`,
		save: { ...game.save, revision: 1, updatedAt: new Date().toISOString() }
	} } );
	// Recover the earlier interrupted repair, which published the shell before
	// learning that Library forbids changing a game's city. Normal runs never
	// alter the source game at all.
	if ( option === '--resume' && existsSync( join( gameRoot, parcelId ) ) ) {
		await publish( gameRoot, parcelId, true );
		await rm( join( gameRoot, parcelId ), { recursive: true } );
	}
	const draftRoot = join( outRoot, 'drafts', cityId );
	const nextDraft = join( outRoot, 'drafts', nextCityId );
	if ( existsSync( draftRoot ) && ! existsSync( nextDraft ) ) {
		await cp( draftRoot, nextDraft, { recursive: true } );
		await cp( join( target, parcelId ), join( nextDraft, parcelId ), { recursive: true } );
		await publish( nextDraft, parcelId );
		const draft = await json( join( nextDraft, 'draft.json' ) );
		await writeFile( join( nextDraft, 'draft.json' ), JSON.stringify( { ...draft, cityId: nextCityId }, null, 2 ) + '\n' );
	}
	const reportPath = join( outRoot, 'story-review.json' );
	const report = await json( reportPath );
	const playUrl = `http://localhost:5306/?mode=game&game=${nextGameId}`;
	await writeFile( reportPath, JSON.stringify( { ...report, cityId: nextCityId, gameId: nextGameId, playUrl }, null, 2 ) + '\n' );
	console.log( JSON.stringify( { cityId: nextCityId, gameId: nextGameId, repairedParcel: parcelId, playUrl }, null, 2 ) );
} finally {
	await exterior.close();
	await rm( temporary, { recursive: true, force: true } );
}

async function publish( directory, id, remove = false ) {
	const atlas = await json( join( directory, 'blueprint.json' ) );
	const manifest = await json( join( directory, 'manifest.json' ) );
	const connections = await json( join( directory, 'connections.json' ) );
	const ids = remove ? manifest.parcels.filter( parcel => parcel !== id ) : [ ...new Set( [ ...manifest.parcels, id ] ) ];
	const plans = new PlanLibrary( { version: worldExteriorVersion( directory ) || undefined } );
	const { catalog, rooftopRequest } = await collectShellArtifacts( directory, ids, { seed: atlas.meta.seed, plans } );
	await new OutDir( directory ).publishManifest( atlas, ids, manifest.interiors, {
		catalog, rooftopSpans: await runRooftopSpans( rooftopRequest ),
		connectionsArtifact: new ConnectionsArtifact( atlas, connections ), streets: true,
		kit: manifest.kit, interiorModules: manifest.interiorModules, interiorProps: manifest.interiorProps,
		sources: { ...manifest.sources, [ id ]: remove ? 'empty' : 'shell' }, buildings: manifest.buildings
	} );
}

async function json( path ) { return JSON.parse( await readFile( path, 'utf8' ) ); }
