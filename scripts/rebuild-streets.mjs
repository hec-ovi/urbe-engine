/** Rebuilds an existing world's streets with the current Streets box and
 * materials binding, from the world's own blueprint and the street seed the
 * world was built with, keeping its blueprint, buildings, save and everything
 * else as they are. A Streets release reaches a built world only through this
 * rebuild, or a new world.
 * Usage: node --import tsx scripts/rebuild-streets.mjs <world under out/, e.g. games/tiny-check>
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStreetArtifacts, shareStreetKit } from '../src/assembly/StreetArtifacts.js';

const engineRoot = fileURLToPath( new URL( '..', import.meta.url ) );
const outDir = join( engineRoot, 'out' );
const [ world, ...rest ] = process.argv.slice( 2 );
const worldDir = resolve( outDir, world ?? '' );
if ( ! world || rest.length || relative( outDir, worldDir ).startsWith( '..' ) ) throw new Error( 'Usage: node --import tsx scripts/rebuild-streets.mjs <world under out/>' );

const worldFile = join( worldDir, 'manifest.json' );
const worldManifest = JSON.parse( await readFile( worldFile, 'utf8' ) );
assert.equal( worldManifest.streets?.file, 'streets/manifest.json', 'World has no native street manifest.' );
const blueprintBytes = await readFile( join( worldDir, 'blueprint.json' ) );
assert.equal( digest( blueprintBytes ), worldManifest.streets.blueprintSha256, 'The world blueprint is not the one its streets were built from.' );
const atlas = JSON.parse( blueprintBytes );

/* Build beside the world, from a copy of its exact blueprint bytes, then move the two files the world owns into place. */
const stage = await mkdtemp( join( worldDir, '.streets-rebuild-' ) );
try {

	await copyFile( join( worldDir, 'blueprint.json' ), join( stage, 'blueprint.json' ) );
	const reference = await buildStreetArtifacts( stage, atlas );
	const sharedKit = shareStreetKit( join( stage, 'streets' ), reference.kitSha256 );
	const before = worldManifest.streets;
	for ( const name of [ 'placements.json', 'manifest.json' ] ) await rename( join( stage, 'streets', name ), join( worldDir, 'streets', `${name}.rebuild` ) );
	await rename( join( worldDir, 'streets', 'placements.json.rebuild' ), join( worldDir, 'streets', 'placements.json' ) );
	await rename( join( worldDir, 'streets', 'manifest.json.rebuild' ), join( worldDir, 'streets', 'manifest.json' ) );
	worldManifest.streets = { ...before, sha256: reference.sha256, kitSha256: reference.kitSha256, blueprintSha256: reference.blueprintSha256, sharedKit };
	await writeFile( `${worldFile}.rebuild`, `${JSON.stringify( worldManifest, null, 2 )}\n` );
	await rename( `${worldFile}.rebuild`, worldFile );
	const streets = JSON.parse( await readFile( join( worldDir, 'streets', 'manifest.json' ), 'utf8' ) );
	console.log( `${world}: streets ${streets.meta.generatorVersion}, kit ${before.sharedKit} -> ${sharedKit}, ${streets.statistics.placements} placements; reload the page to see it` );

} finally { await rm( stage, { recursive: true, force: true } ); }

function digest( bytes ) { return createHash( 'sha256' ).update( bytes ).digest( 'hex' ); }
