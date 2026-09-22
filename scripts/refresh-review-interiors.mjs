#!/usr/bin/env -S node --import tsx
// Refresh authored interiors through the normal producer boundary, retaining
// shell bytes, quests, saves and world identities. Paths must name assembled
// worlds with manifests. One world publishes only after every interior succeeds.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BuildingBlueprints } from '../src/assembly/BuildingBlueprints.js';
import { BuildingPipeline } from '../src/assembly/BuildingPipeline.js';
import { InteriorModules } from '../src/assembly/InteriorModules.js';
import { OutDir } from '../src/assembly/OutDir.js';
import { PlanLibrary, worldExteriorVersion } from '../src/assembly/kit/index.js';
import { validateWorldManifest } from '../src/assembly/validators.js';

const worlds = process.argv.slice( 2 ).map( directory => resolve( directory ) );
if ( ! worlds.length ) throw new Error( 'Pass one or more assembled world directories.' );
process.env.URBE_ASSEMBLY_WORKERS = '4';
process.env.URBE_ASSEMBLY_MAX_TEMP = '88';
const resources = await new InteriorModules().publish();
for ( const directory of worlds ) await refresh( directory );

async function refresh( directory ) {
	const manifestPath = join( directory, 'manifest.json' );
	const manifest = JSON.parse( await readFile( manifestPath, 'utf8' ) );
	const atlas = JSON.parse( await readFile( join( directory, 'blueprint.json' ), 'utf8' ) );
	const library = new PlanLibrary( { version: worldExteriorVersion( directory ) || undefined } );
	const blueprints = new BuildingBlueprints( directory, library );
	const originalShells = new Map();
	const staged = await mkdtemp( join( directory, '.interiors-' ) );
	const promoted = [];
	try {
		const pipeline = new BuildingPipeline( {
			assembleInterior: ( id, { blueprint } ) => {
				const parcel = atlas.parcels.find( entry => entry.id === id );
				const request = requests.get( id );
				return { seed: request?.seed ?? `${atlas.meta.seed}:${id}`,
					building: { id, type: request?.building.type ?? parcel.type, tier: request?.building.tier ?? parcel.tier },
					blueprint, materialTheme: request?.theme ?? 'cyberpunk' };
			}
		} );
		const requests = new Map();
		for ( const id of manifest.interiors ) {
			const requestFile = join( directory, id, `${id}.request.json` );
			if ( existsSync( requestFile ) ) requests.set( id, JSON.parse( await readFile( requestFile, 'utf8' ) ) );
			for ( const file of [ `${id}.glb`, `${id}.blueprint.json`, `${id}.placements.json` ] ) {
				const path = join( directory, id, file );
				if ( existsSync( path ) ) originalShells.set( path, digest( await readFile( path ) ) );
			}
			await mkdir( join( staged, id ), { recursive: true } );
			await pipeline.furnish( id, join( staged, id ), { blueprint: await blueprints.of( id ), refit: false } );
			console.log( `Prepared ${directory}: ${id}` );
		}
		const stagedOut = new OutDir( staged );
		const updated = { ...manifest, interiorModules: resources.modules, interiorProps: resources.props,
			floors: Object.fromEntries( manifest.interiors.map( id => [ id, stagedOut.floorsOf( id ) ] ) ) };
		const errors = validateWorldManifest( updated );
		if ( errors.length ) throw new Error( JSON.stringify( errors ) );
		for ( const [ path, hash ] of originalShells ) if ( digest( await readFile( path ) ) !== hash ) throw new Error( `Shell changed during interior refresh: ${path}` );
		await writeFile( join( staged, 'manifest.json' ), JSON.stringify( updated, null, 2 ) + '\n' );
		for ( const id of manifest.interiors ) {
			const target = join( directory, id, 'interior' );
			const backup = join( staged, id, 'previous' );
			await rename( target, backup );
			promoted.push( { target, backup } );
			await rename( join( staged, id, 'interior' ), target );
		}
		await rename( join( staged, 'manifest.json' ), manifestPath );
		promoted.length = 0;
		console.log( `Refreshed ${directory}: ${manifest.interiors.length} interiors; shell hashes unchanged.` );
	} catch ( error ) {
		for ( const { target, backup } of promoted.reverse() ) {
			await rm( target, { recursive: true, force: true } );
			await rename( backup, target );
		}
		throw error;
	} finally { await rm( staged, { recursive: true, force: true } ); }
}

function digest( bytes ) { return createHash( 'sha256' ).update( bytes ).digest( 'hex' ); }
