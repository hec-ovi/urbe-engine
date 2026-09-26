import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { AssemblyError } from './RequestAssembler.js';
import { PLAN_INDEX_FILE } from './kit/KitFiles.js';

/** Where every world's shared resources stand, one copy per distinct set. */
export const SHARED_DIR = fileURLToPath( new URL( '../../out/shared/', import.meta.url ) );
/** Where worlds stand: the manifests under here are what the store is kept for. */
export const OUT_DIR = fileURLToPath( new URL( '../../out/', import.meta.url ) );
/** How much of a set's hash names its folder; enough that two sets never collide. */
const PREFIX = 16;
/** One set's folder under its kind, and nothing else in the store is one. */
const ENTRY = /^[0-9a-f]{16}$/;
/** Where a batch draws plans before they enter the store. */
export const STAGING = '.staging';
/** What a world on disk is found by; `OutDir` is what writes it. */
const MANIFEST_FILE = 'manifest.json';
/** Standalone paired previews bind their room/furniture resources here. */
const PREVIEW_FILE = 'preview.json';
/**
 * How long a set a batch used is spared by a sweep that finds no world naming
 * it: a batch names its sets in its manifest only when it ends, and none takes
 * anywhere near a day. Staging a batch left behind waits as long.
 */
export const SWEEP_GRACE_MS = 24 * 60 * 60 * 1000;

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

	if ( markUsed( destination ) ) {

		if ( move ) rmSync( source, { recursive: true, force: true } );
		return path;

	}

	mkdirSync( dirname( destination ), { recursive: true } );
	take( source, destination, move );

	return path;

}

/**
 * Marks one set used now, so a sweep spares it until the manifest that will
 * name it is written. A set another user owns stands but keeps its time.
 * @returns whether the set stands
 */
export function markUsed( directory ) {

	const now = new Date();

	try {

		utimesSync( directory, now, now );
		return true;

	} catch {

		return existsSync( directory );

	}

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
 * reads every world manifest and paired preview under the worlds root, keeps
 * their sets and the plan sets their kit index names, and deletes the rest.
 * Nothing outside the store is read for deletion and nothing outside it is
 * touched. A manifest, preview or plan index that cannot be read stops the
 * sweep before anything goes, because the sets it names cannot be known.
 *
 * @param root where worlds stand, each one a folder holding a manifest.json
 * @param worlds extra world folders, for a build published outside root
 * @param options.grace milliseconds a set used that recently is spared, named or not
 * @param options.dryRun report what would go and delete nothing
 * @returns `{ removed, kept, failed }`, each the set paths and what they weigh
 * in bytes; `failed` holds the sets the sweep could not delete (another owner's)
 * @throws AssemblyError E_SWEEP_UNREADABLE, having removed nothing
 */
export function collect( root = OUT_DIR, worlds = [], { grace = 0, dryRun = false } = {} ) {

	const now = Date.now();
	const store = sharedRoot();
	const live = new Set();

	for ( const dir of [ root, ...worlds ] ) {

		for ( const manifest of manifests( dir, store ) ) for ( const set of referenced( manifest ) ) live.add( set );

	}

	for ( const set of [ ...live ] ) for ( const plan of planSets( store, set ) ) live.add( plan );

	const removed = { entries: [], bytes: 0 };
	const kept = { entries: [], bytes: 0 };
	const failed = { entries: [], bytes: 0 };
	const sweep = ( entry, spared ) => {

		const path = join( store, entry );
		const bytes = dirBytes( path );
		let side = spared ? kept : removed;

		if ( ! spared && ! dryRun ) {

			try { rmSync( path, { recursive: true, force: true } ); } catch { side = failed; }

		}
		side.entries.push( entry );
		side.bytes += bytes;

	};

	for ( const entry of entries( store ) ) sweep( entry, live.has( entry ) || ( grace > 0 && usedSince( join( store, entry ), now - grace ) ) );

	// Staging a batch left behind when it stopped: it is no set, so only its age tells.
	for ( const entry of leftovers( store ) ) {

		if ( ! usedSince( join( store, entry ), now - SWEEP_GRACE_MS ) ) sweep( entry, false );

	}

	return { removed, kept, failed };

}

/** One line for a sweep: what it dropped, what stands, and of what kind. */
export function sweepLine( { removed, kept, failed }, { dryRun = false } = {} ) {

	const kinds = new Map();

	for ( const entry of kept.entries ) {

		const kind = entry.split( '/' )[ 0 ];
		kinds.set( kind, ( kinds.get( kind ) ?? 0 ) + 1 );

	}

	const standing = [ ...kinds ].sort().map( ( [ kind, count ] ) => `${count} ${kind}` ).join( ', ' );
	const stuck = failed.entries.length ? `; could not remove ${failed.entries.length}, ${megabytes( failed.bytes )}` : '';

	return `shared store: ${dryRun ? 'would remove' : 'removed'} ${removed.entries.length} sets, ${megabytes( removed.bytes )}; `
		+ `kept ${kept.entries.length}, ${megabytes( kept.bytes )}${standing ? ` (${standing})` : ''}${stuck}`;

}

/** What one file or directory weighs on disk. */
export function dirBytes( path ) {

	const stat = statSync( path );

	if ( ! stat.isDirectory() ) return stat.size;

	let total = 0;

	for ( const name of readdirSync( path ) ) total += dirBytes( join( path, name ) );

	return total;

}

/**
 * Every set on disk: one folder per kind, one folder per hash under it.
 * Staging is not a set and is never one of them.
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

/** What batches stage into: the folders under `.staging` and every other dot folder of the store. */
function* leftovers( store ) {

	if ( ! existsSync( store ) ) return;

	for ( const entry of readdirSync( store, { withFileTypes: true } ) ) {

		if ( ! entry.isDirectory() || ! entry.name.startsWith( '.' ) ) continue;
		if ( entry.name !== STAGING ) yield entry.name;
		else for ( const staged of readdirSync( join( store, STAGING ) ) ) yield `${STAGING}/${staged}`;

	}

}

/** Whether a folder was written or marked used after `since`. */
function usedSince( path, since ) {

	return statSync( path ).mtimeMs > since;

}

/** Every world or standalone preview; the walk stops at each published artifact. */
function* manifests( dir, store ) {

	if ( ! existsSync( dir ) || resolve( dir ) === resolve( store ) ) return;

	const manifest = readJson( join( dir, MANIFEST_FILE ) );
	const preview = readJson( join( dir, PREVIEW_FILE ) );
	if ( preview ) yield { interiorModules: preview.interiorModules, interiorProps: preview.interiorProps };

	if ( manifest ) return yield manifest;
	if ( preview ) return;

	for ( const child of readdirSync( dir, { withFileTypes: true } ) ) {

		if ( child.isDirectory() ) yield* manifests( join( dir, child.name ), store );

	}

}

/** The sets one manifest names: its `shared` references and the street kit. */
function referenced( manifest ) {

	return [ manifest.kit?.shared, manifest.interiorModules?.shared,
		manifest.interiorProps?.shared, manifest.streets?.sharedKit ].filter( Boolean );

}

/**
 * The plan sets a kit index names, which a world reaches only through it. A
 * kit set this store does not hold names nothing here: its world draws from
 * another store, or cannot draw its kit at all.
 */
function planSets( store, entry ) {

	const index = readJson( join( store, entry, PLAN_INDEX_FILE ) );

	return ( index?.plans ?? [] )
		.flatMap( ( plan ) => [ plan.glb, plan.blueprint ] )
		.filter( ( file ) => typeof file === 'string' )
		.map( ( file ) => file.split( '/' ).slice( 0, 2 ).join( '/' ) );

}

const megabytes = ( bytes ) => `${( bytes / 1e6 ).toFixed( 1 )} MB`;

/** A JSON file, or null when there is none; one that cannot be read stops the sweep. */
function readJson( path ) {

	if ( ! existsSync( path ) ) return null;

	try {

		return JSON.parse( readFileSync( path, 'utf8' ) );

	} catch ( error ) {

		throw new AssemblyError( 'E_SWEEP_UNREADABLE', `${path} cannot be read, so the sets it names are unknown: ${error.message}` );

	}

}
