#!/usr/bin/env node
// Use the same creation boundary as the launcher. Existing games are preserved;
// creation gives each new playthrough a fresh id when one already exists.
// --quests-only replays the story over the draft's opened interiors again.
// node scripts/create-story-review.mjs [existing-city-id]
// node scripts/create-story-review.mjs --fresh [city-name] [seed]
// node scripts/create-story-review.mjs --quests-only <existing-city-id>
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { createWorldCreation } from '../src/creation/index.js';

const engineRoot = fileURLToPath( new URL( '..', import.meta.url ) );
const args = process.argv.slice( 2 );
process.env.URBE_ASSEMBLY_WORKERS = '4';
process.env.URBE_ASSEMBLY_MAX_TEMP = '88';
const creation = createWorldCreation( {
	engineRoot,
	atlasRoot: resolve( engineRoot, '../atlas' ),
	questsRoot: resolve( engineRoot, '../quests' ),
	outDir: join( engineRoot, 'out' )
} );

let cityId = args[ 0 ] ?? 'small-city-5e56c399';
const questsOnly = cityId === '--quests-only';
if ( questsOnly ) {
	cityId = args[ 1 ];
	if ( ! cityId || ! /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/.test( cityId ) ) throw new Error( 'Pass an existing city id after --quests-only.' );
}
if ( cityId === '--fresh' ) {
	const name = args[ 1 ] ?? 'Building and quest review';
	const seed = args[ 2 ] ?? '863c39de-9e8a-45e3-94b2-f9f296eafef9';
	console.log( `Generating small city: ${name}` );
	const city = await creation.generateCity( { name, seed, size: 'small' } );
	cityId = city.id;
}

let interiors;
if ( questsOnly ) {
	// The quest stage replays the story into a folder of its own and publishes it
	// whole, so a game made from this draft keeps the story it was made with.
	const draft = JSON.parse( await readFile( join( engineRoot, 'out/drafts', cityId, 'draft.json' ), 'utf8' ) );
	interiors = { ids: draft.interiorIds, count: draft.interiorIds.length };
} else {
	console.log( `Opening nine story locations in ${cityId}` );
	interiors = await creation.generateInstances( { cityId, mode: 'automatic', count: 9, buildingIds: [] } );
}
console.log( `Opened: ${interiors.ids.join( ', ' )}` );
const quests = await creation.generateQuests( { cityId, interiorIds: interiors.ids, mainBrief: '', sideJobs: 3 } );
const game = await creation.createGame( { cityId, interiorIds: interiors.ids, questId: quests.id } );
const result = {
	gameId: game.id,
	cityId,
	interiors: interiors.ids,
	mainSteps: quests.mainSteps,
	sideJobs: quests.sideJobs,
	playUrl: `http://localhost:5306/?mode=game&game=${encodeURIComponent( game.id )}`
};
await writeFile( join( engineRoot, 'out', 'story-review.json' ), JSON.stringify( result, null, 2 ) + '\n' );
console.log( JSON.stringify( result, null, 2 ) );
