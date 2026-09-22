#!/usr/bin/env node
// Refresh conversation text in an existing playthrough without changing its save,
// cast, quest mechanics or city. Optional presentation refresh names one quest.
// node scripts/refresh-quest-dialogue.mjs <game-id> [--check] [--recording=<path>] [--presentation=<quest-id>]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QuestlineSetValidator, QuestlineStateValidator } from '../../quests/dist/runtime.js';
import { createLibrary } from '../src/library/index.js';
import { QUEST_BUNDLE_FILES, questBundle as publicQuestBundle, questBundleManifest } from '../src/quest-bundle/index.js';

const engineRoot = fileURLToPath( new URL( '..', import.meta.url ) );
const questsRoot = resolve( engineRoot, '../quests' );
const outDir = join( engineRoot, 'out' );
const [ gameId, ...options ] = process.argv.slice( 2 );
if ( ! /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test( gameId ?? '' )
	|| options.some( option => option !== '--check' && ! option.startsWith( '--recording=' ) && ! option.startsWith( '--presentation=' ) ) ) {
	throw new Error( 'Usage: node scripts/refresh-quest-dialogue.mjs <game-id> [--check] [--recording=<path>] [--presentation=<quest-id>]' );
}
const checkOnly = options.includes( '--check' );
const presentationIds = new Set( options.filter( option => option.startsWith( '--presentation=' ) ).map( option => option.slice( 15 ) ) );
const recording = resolve( options.find( option => option.startsWith( '--recording=' ) )?.slice( 12 )
	?? join( questsRoot, 'creation/samples/urbe-small/recording.json' ) );
const gameDir = join( outDir, 'games', gameId );
const library = createLibrary( { outDir } );
const game = await library.loadGame( { id: gameId } );
if ( ! game.questBundle?.uri.endsWith( '/quest-bundle.json' ) ) throw new Error( 'Game must carry a v1.1 quest bundle.' );
const gameFile = join( gameDir, 'game.json' );
const descriptorBytes = await readFile( gameFile );
assert.deepEqual( JSON.parse( descriptorBytes ), game, 'Save changed while reading; retry after gameplay has stopped.' );
const bundleFile = join( gameDir, game.questBundle.uri );
const bundleBytes = await readFile( bundleFile );
assert.equal( game.questBundle.checksum, `sha256:${digest( bundleBytes )}`, 'Game bundle checksum is stale.' );
assert.equal( game.questBundle.byteSize, bundleBytes.length, 'Game bundle byte size is stale.' );
const carried = await readBundle( bundleFile );
new QuestlineSetValidator().validate( carried.questlines );
const questlinesFile = join( dirname( bundleFile ), carried.manifest.files.questlines );
const originalBytes = await readFile( questlinesFile );
const protectedFiles = new Map();
for ( const path of [ gameFile, bundleFile, ...[ 'blueprint.json', 'npc-types.json', 'manifest.json' ].map( name => join( gameDir, name ) ),
	...QUEST_BUNDLE_FILES.filter( name => name !== 'questlines' ).map( name => join( dirname( bundleFile ), carried.manifest.files[ name ] ) ) ] ) {
	protectedFiles.set( path, digest( await readFile( path ) ) );
}
const worldManifest = JSON.parse( await readFile( join( gameDir, 'manifest.json' ), 'utf8' ) );
assert.deepEqual( [ ...worldManifest.interiors ].sort(), [ ...game.selectedInteriors ].sort(), 'Game and world select different interiors.' );

await mkdir( join( outDir, '.work' ), { recursive: true } );
const staged = await mkdtemp( join( outDir, '.work/dialogue-' ) );
let promoted = false;
try {
	await materialize( join( staged, 'questlines.json' ) );
	const authored = await readBundle( join( staged, 'quest-bundle.json' ) );
	new QuestlineSetValidator().validate( authored.questlines );
	const updated = structuredClone( carried.questlines );
	for ( const id of presentationIds ) assert.ok( updated.some( definition => definition.id === id ), `Unknown presentation quest ${id}.` );
	const refreshedSteps = [];
	for ( const definition of updated ) {
		const source = authored.questlines.find( candidate => candidate.id === definition.id );
		assert.ok( source, `Materialization did not produce ${definition.id}.` );
		assert.deepEqual( source.steps.map( step => step.stepId ), definition.steps.map( step => step.stepId ), `${definition.id}: step identities changed.` );
		for ( const step of definition.steps ) {
			if ( step.target.kind !== 'talk' && ! presentationIds.has( definition.id ) ) continue;
			const sourceStep = source.steps.find( candidate => candidate.stepId === step.stepId );
			assert.deepEqual( sourceStep.target, step.target, `${definition.id}/${step.stepId}: target changed.` );
			for ( const field of [ 'gives', 'needs', 'conditions', 'effects', 'next', 'branching', 'endingId', 'window' ] ) {
				assert.deepEqual( sourceStep[ field ], step[ field ], `${definition.id}/${step.stepId}: ${field} changed; text-only refresh is unsafe.` );
			}
			if ( presentationIds.has( definition.id ) ) step.narrative = structuredClone( sourceStep.narrative );
			if ( step.target.kind !== 'talk' ) continue;
			const role = definition.roles.find( candidate => candidate.roleId === step.target.roleId );
			const sourceRole = source.roles.find( candidate => candidate.roleId === step.target.roleId );
			assert.deepEqual( sourceRole?.characterName, role?.characterName, `${definition.id}/${step.stepId}: authored character identity changed.` );
			assert.ok( sourceStep.dialogue, `${definition.id}/${step.stepId}: authored dialogue is missing.` );
			step.dialogue = structuredClone( sourceStep.dialogue );
			refreshedSteps.push( `${definition.id}/${step.stepId}` );
		}
		if ( presentationIds.has( definition.id ) ) {
			assert.deepEqual( source.items.map( item => item.itemId ), definition.items.map( item => item.itemId ), `${definition.id}: item identities changed.` );
			for ( const item of definition.items ) {
				const sourceItem = source.items.find( candidate => candidate.itemId === item.itemId );
				item.name = sourceItem.name;
				item.description = sourceItem.description;
			}
		}
	}
	assert.deepEqual( withoutUpdatedText( updated ), withoutUpdatedText( carried.questlines ), 'Refresh changed protected quest data.' );
	new QuestlineSetValidator().validate( updated );
	publicQuestBundle( carried.manifest, { ...carried, questlines: updated } );
	for ( const progress of [ ...game.quests, ...game.sideJobs ] ) {
		if ( ! progress.runtime ) continue;
		const definition = updated.find( candidate => candidate.id === progress.id );
		assert.ok( definition, `Saved quest ${progress.id} has no definition.` );
		new QuestlineStateValidator().validate( definition, progress.runtime.state );
		for ( const role of definition.roles ) assert.ok( progress.runtime.cast[ role.roleId ], `Saved cast missing ${role.roleId}.` );
	}
	const replacement = Buffer.from( JSON.stringify( updated, null, 2 ) + '\n' );
	const report = {
		gameId, checkOnly, refreshedTalks: refreshedSteps.length, refreshedPresentationQuestIds: [ ...presentationIds ],
		choices: updated.flatMap( definition => definition.steps.flatMap( step => step.dialogue?.choices ?? [] ) ).length,
		questlinesFile, beforeSha256: digest( originalBytes ), afterSha256: digest( replacement ),
		gameSha256: digest( descriptorBytes ), bundleSha256: digest( bundleBytes ),
		progress: [ ...game.quests, ...game.sideJobs ].map( quest => ( {
			id: quest.id, completedSteps: quest.completedSteps, activeStepIds: quest.runtime?.state.activeStepIds
		} ) ),
		refreshedSteps
	};
	await assertProtectedFiles();
	assert.equal( digest( await readFile( questlinesFile ) ), digest( originalBytes ), 'Questlines changed during refresh.' );
	if ( ! checkOnly && ! replacement.equals( originalBytes ) ) {
		const backupDir = join( outDir, 'diagnostics', 'quest-dialogue', `${gameId}-${new Date().toISOString().replace( /[:.]/g, '-' )}` );
		await mkdir( backupDir, { recursive: true } );
		await writeFile( join( backupDir, 'questlines.before.json' ), originalBytes );
		await writeFile( join( backupDir, 'game.before.json' ), descriptorBytes );
		await writeFile( join( backupDir, 'refresh.json' ), JSON.stringify( report, null, 2 ) + '\n' );
		const candidateFile = join( staged, 'questlines.promote.json' );
		await writeFile( candidateFile, replacement );
		await rename( candidateFile, questlinesFile );
		promoted = true;
		report.backupDir = backupDir;
	}
	await assertProtectedFiles();
	await library.loadGame( { id: gameId } );
	await readBundle( bundleFile );
	console.log( JSON.stringify( { ...report, descriptorUnchanged: true, protectedQuestDataUnchanged: true,
		nonDialogueDataUnchanged: presentationIds.size === 0 }, null, 2 ) );
} catch ( error ) {
	if ( promoted ) {
		const rollback = join( staged, 'questlines.rollback.json' );
		await writeFile( rollback, originalBytes );
		await rename( rollback, questlinesFile );
	}
	throw error;
} finally {
	await rm( staged, { recursive: true, force: true } );
}

async function assertProtectedFiles() {
	for ( const [ path, hash ] of protectedFiles ) assert.equal( digest( await readFile( path ) ), hash, `Protected file changed: ${path}` );
}

async function readBundle( file ) {
	const manifest = questBundleManifest( JSON.parse( await readFile( file, 'utf8' ) ) );
	const catalogs = Object.fromEntries( await Promise.all( QUEST_BUNDLE_FILES.map( async name => [
		name, JSON.parse( await readFile( join( dirname( file ), manifest.files[ name ] ), 'utf8' ) )
	] ) ) );
	return publicQuestBundle( manifest, catalogs );
}

async function materialize( output ) {
	await new Promise( ( done, reject ) => {
		const child = spawn( 'npm', [ 'run', 'materialize', '--', recording, game.size,
			join( gameDir, 'blueprint.json' ), join( gameDir, 'npc-types.json' ), output,
			`--parcels=${game.selectedInteriors.join( ',' )}`
		], { cwd: questsRoot, stdio: [ 'ignore', 'inherit', 'inherit' ] } );
		child.once( 'error', reject );
		child.once( 'exit', code => code === 0 ? done() : reject( new Error( `Quest materialization exited ${code}` ) ) );
	} );
}

function withoutUpdatedText( definitions ) {
	return definitions.map( definition => ( {
		...definition,
		items: definition.items.map( item => {
			const { name, description, ...protectedItem } = item;
			return presentationIds.has( definition.id ) ? protectedItem : item;
		} ),
		steps: definition.steps.map( ( { dialogue, ...step } ) => {
			const { narrative, ...protectedStep } = step;
			return presentationIds.has( definition.id ) ? protectedStep : step;
		} )
	} ) );
}

function digest( bytes ) { return createHash( 'sha256' ).update( bytes ).digest( 'hex' ); }
