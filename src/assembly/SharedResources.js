import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { PLAN_INDEX_FILE } from './kit/KitFiles.js';

/** Where every world's shared resources stand, one copy per distinct set. */
export const SHARED_DIR = fileURLToPath( new URL( '../../out/shared/', import.meta.url ) );
/** Where worlds stand: the manifests under here are what the store is kept for. */
export const OUT_DIR = fileURLToPath( new URL( '../../out/', import.meta.url ) );
/** How much of a set's hash names its folder; enough that two sets never collide. */
const PREFIX = 16;
/** One set's folder under its kind, and nothing else in the store is one. */
const ENTRY = /^[0-9a-f]{16}$/;
/** What a world on disk is found by; `OutDir` is what writes it. */
const MANIFEST_FILE = 'manifest.json';

/**
 * Resources a world references instead of carrying.
 *
 * The piece kit, the street kit and the interior modules with their furniture
 * are the same bytes for every city built from the same boxes, and the
 * furniture alone is 64 MB. So each set is published once under the hash of
 * what it holds, and a world's manifest names it by that hash: a hundred
 * cities on this machine share one copy, and a set nothing points at any more
 * is a folder to delete rather than a rebuild.
 *
 * `URBE_SHARED_DIR` moves the store off the engine's own `out/`.
 */
export function sharedRoot() {

	return process.env.URBE_SHARED_DIR || SHARED_DIR;

}

/** What a set of these bytes is called under the store. */
export function sharedPath( kind, sha256 ) {

	return `${kind}/${sha256.slice( 0, PREFIX )}`;

}

/**
 * Puts one directory in the store under the hash of what it holds, once. A set
 * that is already there is left exactly as it stands.
 * @param move true to take the source directory rather than copy it
 * @returns its path under the store, which is what the manifest names
 */
export function share( kind, sha256, source, { move = false } = {} ) {

	const path = sharedPath( kind, sha256 );
	const destination = join( sharedRoot(), path );

	if ( existsSync( destination ) ) {

		if ( move ) rmSync( source, { recursive: true, force: true } );
		return path;

	}

	mkdirSync( dirname( destination ), { recursive: true } );
	take( source, destination, move );

	return path;

}

/** Moves or copies one path, falling back to a copy across filesystems. */
export function take( source, destination, move = true ) {

	try {

		if ( move ) renameSync( source, destination );
		else cpSync( source, destination, { recursive: true } );

	} catch ( error ) {

		if ( ! move || error.code !== 'EXDEV' ) throw error;
		cpSync( source, destination, { recursive: true } );
		rmSync( source, { recursive: true, force: true } );

	}

}

/**
 * Drops every set no world points at any more.
 *
 * A rebuild publishes what it drew under fresh hashes, so a night of them
 * leaves a store many times the size of the cities standing on disk. A sweep
 * reads every manifest under the worlds root, keeps the sets they name and the
 * plan sets their kit index names, and deletes the rest. Nothing outside the
 * store is read for deletion and nothing outside it is touched.
 *
 * @param root where worlds stand, each one a folder holding a manifest.json
 * @param worlds extra world folders, for a build published outside root
 * @returns `{ removed, kept }`, each the set paths and what they weigh in bytes
 */
export function collect( root = OUT_DIR, worlds = [] ) {

	const store = sharedRoot();
	const live = new Set();

	for ( const dir of [ root, ...worlds ] ) {

		for ( const manifest of manifests( dir, store ) ) for ( const set of referenced( manifest ) ) live.add( set );

	}

	for ( const set of [ ...live ] ) for ( const plan of planSets( store, set ) ) live.add( plan );

	const removed = { entries: [], bytes: 0 };
	const kept = { entries: [], bytes: 0 };

	for ( const entry of entries( store ) ) {

		const path = join( store, entry );
		const side = live.has( entry ) ? kept : removed;

		side.entries.push( entry );
		side.bytes += dirBytes( path );
		if ( side === removed ) rmSync( path, { recursive: true, force: true } );

	}

	return { removed, kept };

}

/** One line for a sweep: what it dropped, what stands, and of what kind. */
export function sweepLine( { removed, kept } ) {

	const kinds = new Map();

	for ( const entry of kept.entries ) {

		const kind = entry.split( '/' )[ 0 ];
		kinds.set( kind, ( kinds.get( kind ) ?? 0 ) + 1 );

	}

	const standing = [ ...kinds ].sort().map( ( [ kind, count ] ) => `${count} ${kind}` ).join( ', ' );

	return `shared store: removed ${removed.entries.length} sets, ${megabytes( removed.bytes )}; `
		+ `kept ${kept.entries.length}, ${megabytes( kept.bytes )}${standing ? ` (${standing})` : ''}`;

}

/** What one directory weighs on disk. */
export function dirBytes( dir ) {

	let total = 0;

	for ( const name of readdirSync( dir ) ) {

		const path = join( dir, name );
		const stat = statSync( path );
		total += stat.isDirectory() ? dirBytes( path ) : stat.size;

	}

	return total;

}

/**
 * Every set on disk: one folder per kind, one folder per hash under it. A
 * staging directory is not a set and is never swept.
 */
function* entries( store ) {

	if ( ! existsSync( store ) ) return;

	for ( const kind of readdirSync( store, { withFileTypes: true } ) ) {

		if ( ! kind.isDirectory() || kind.name.startsWith( '.' ) ) continue;

		for ( const set of readdirSync( join( store, kind.name ), { withFileTypes: true } ) ) {

			if ( set.isDirectory() && ENTRY.test( set.name ) ) yield `${kind.name}/${set.name}`;

		}

	}

}

/** Every world under a folder; the walk stops at each manifest it finds. */
function* manifests( dir, store ) {

	if ( ! existsSync( dir ) || resolve( dir ) === resolve( store ) ) return;

	const manifest = readJson( join( dir, MANIFEST_FILE ) );

	if ( manifest ) return yield manifest;

	for ( const child of readdirSync( dir, { withFileTypes: true } ) ) {

		if ( child.isDirectory() ) yield* manifests( join( dir, child.name ), store );

	}

}

/** The sets one manifest names: its `shared` references and the street kit. */
function referenced( manifest ) {

	return [ manifest.kit?.shared, manifest.interiorModules?.shared,
		manifest.interiorProps?.shared, manifest.streets?.sharedKit ].filter( Boolean );

}

/** The plan sets a kit index names, which a world reaches only through it. */
function planSets( store, entry ) {

	const index = readJson( join( store, entry, PLAN_INDEX_FILE ) );

	return ( index?.plans ?? [] )
		.flatMap( ( plan ) => [ plan.glb, plan.blueprint ] )
		.filter( ( file ) => typeof file === 'string' )
		.map( ( file ) => file.split( '/' ).slice( 0, 2 ).join( '/' ) );

}

const megabytes = ( bytes ) => `${( bytes / 1e6 ).toFixed( 1 )} MB`;

function readJson( path ) {

	try {

		return JSON.parse( readFileSync( path, 'utf8' ) );

	} catch {

		return null;

	}

}
