#!/usr/bin/env node
// Refresh the street material snapshot of an existing world to the current
// materials binding, without changing its streets, save or anything else.
// A world keeps the binding it was built with (streets/manifest.json
// materials.binding, hashed as meta.nativeCatalogHash, and the file itself
// hashed in manifest.json streets.sha256), so a materials release reaches it
// only through this refresh.
// node scripts/refresh-street-materials.mjs <world under out/, e.g. games/tiny-check> [--check]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const engineRoot = fileURLToPath( new URL( '..', import.meta.url ) );
const outDir = join( engineRoot, 'out' );
const materialsRoot = resolve( engineRoot, '../materials' );
const [ world, ...options ] = process.argv.slice( 2 );
const worldDir = resolve( outDir, world ?? '' );
if ( ! world || relative( outDir, worldDir ).startsWith( '..' ) || options.some( option => option !== '--check' ) ) {
	throw new Error( 'Usage: node scripts/refresh-street-materials.mjs <world under out/> [--check]' );
}
const checkOnly = options.includes( '--check' );

const worldFile = join( worldDir, 'manifest.json' );
const worldManifest = JSON.parse( await readFile( worldFile, 'utf8' ) );
assert.equal( worldManifest.streets?.file, 'streets/manifest.json', 'World has no native street manifest.' );
const streetsFile = join( worldDir, worldManifest.streets.file );
const streetsBytes = await readFile( streetsFile );
assert.equal( digest( streetsBytes ), worldManifest.streets.sha256, 'Street manifest does not match the world manifest; rebuild the world instead.' );
const streets = JSON.parse( streetsBytes );
assert.equal( streets.materials?.mode, 'native-reference', 'Street manifest carries no native material snapshot.' );
assert.equal( jsonHash( streets.materials.binding ), streets.meta.nativeCatalogHash, 'Street material snapshot hash is already stale.' );

const binding = JSON.parse( await readFile( join( materialsRoot, 'bindings/street-native.json' ), 'utf8' ) );
const missing = [];
for ( const [ id, texture ] of Object.entries( binding.textures ?? {} ) ) {
	for ( const [ path, sha256 ] of [ [ texture.path, texture.sha256 ], [ texture.ktx2, texture.ktx2Sha256 ] ] ) {
		if ( ! path ) continue;
		const bytes = await readFile( join( materialsRoot, path ) ).catch( () => null );
		if ( ! bytes ) missing.push( `${id}: ${path} is missing` );
		else if ( sha256 && digest( bytes ) !== sha256 ) missing.push( `${id}: ${path} differs from its sha256` );
	}
}
assert.deepEqual( missing, [], `The current binding names textures the materials checkout cannot serve:\n${missing.join( '\n' )}` );

const current = jsonHash( binding );
if ( current === streets.meta.nativeCatalogHash ) {
	console.log( `${world}: street materials already current (${current.slice( 0, 12 )})` );
	process.exit( 0 );
}
console.log( `${world}: street materials ${streets.meta.nativeCatalogHash.slice( 0, 12 )} -> ${current.slice( 0, 12 )}` );
if ( checkOnly ) process.exit( 1 );

streets.materials.binding = binding;
streets.meta.nativeCatalogHash = current;
const refreshed = Buffer.from( JSON.stringify( streets ) );
worldManifest.streets.sha256 = digest( refreshed );
// The street manifest first, then the world manifest that vouches for it, each written whole and renamed into place.
await replace( streetsFile, refreshed );
await replace( worldFile, `${JSON.stringify( worldManifest, null, 2 )}\n` );
console.log( `${world}: refreshed; reload the page to see it` );

function digest( bytes ) { return createHash( 'sha256' ).update( bytes ).digest( 'hex' ); }
function jsonHash( value ) { return digest( Buffer.from( JSON.stringify( value ) ) ); }
async function replace( file, bytes ) {
	await writeFile( `${file}.refresh`, bytes );
	await rename( `${file}.refresh`, file );
}
