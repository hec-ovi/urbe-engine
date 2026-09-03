import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import AjvModule from 'ajv/dist/2020.js';

const Ajv2020 = AjvModule.default ?? AjvModule;
const REQUEST_SCHEMA = new URL( './schema/building-build-request.schema.json', import.meta.url );

export class BuildingBuildError extends Error {

	constructor( code, message, status ) {

		super( message );
		this.name = 'BuildingBuildError';
		this.code = code;
		this.status = status;

	}

}

/**
 * Development-only boundary for a building selected in an Atlas preview.
 * It accepts only one known output folder, one source and one parcel from that
 * world's carried blueprint or a named Atlas sample, then delegates to
 * assembly's real CLI. Assembly validates Connections, Exterior and Interior
 * at their schema boundaries.
 */
export class BuildingBuildService {

	#active = new Map();

	constructor( { engineRoot, atlasDir, build = runAssembly } ) {

		this.engineRoot = resolve( engineRoot );
		this.outRoot = join( this.engineRoot, 'out' );
		this.atlasDir = resolve( atlasDir );
		this.build = build;
		this.validate = new Ajv2020( { allErrors: true } ).compile( JSON.parse( readFileSync( REQUEST_SCHEMA, 'utf8' ) ) );

	}

	async ensure( input ) {

		if ( ! this.validate( input ) ) {

			const details = this.validate.errors.map( ( error ) => `${error.instancePath || '/'} ${error.message}` ).join( '; ' );
			throw new BuildingBuildError( 'E_INVALID_REQUEST', details, 400 );

		}

		const { parcel, out, source = 'shell' } = input;
		const outDir = resolve( this.engineRoot, `.${out}` );

		if ( outDir !== this.outRoot && ! outDir.startsWith( this.outRoot + sep ) ) {

			throw new BuildingBuildError( 'E_INVALID_REQUEST', `output is outside /out: ${out}`, 400 );

		}

		const parcelDir = join( outDir, parcel );
		if ( complete( parcelDir, parcel, source ) ) return { parcel, out, source, built: false };

		const blueprintPath = this.#blueprint( outDir, basename( outDir ) );
		const atlas = readJson( blueprintPath, 'E_WORLD_INVALID', 422 );

		if ( ! Array.isArray( atlas.parcels ) || ! atlas.parcels.some( ( candidate ) => candidate.id === parcel ) ) {

			throw new BuildingBuildError( 'E_PARCEL_NOT_FOUND', `${parcel} is not a parcel in ${out}`, 404 );

		}

		const key = `${out}:${parcel}:${source}`;
		if ( ! this.#active.has( key ) ) {

			this.#active.set( key, this.#build( { parcel, out, source, outDir: parcelDir, blueprintPath } ) );

		}

		try {

			await this.#active.get( key );

		} finally {

			this.#active.delete( key );

		}

		if ( ! complete( parcelDir, parcel, source ) ) {

			throw new BuildingBuildError( 'E_BUILD_INCOMPLETE', `assembly did not publish the ${source} for ${parcel}`, 500 );

		}

		return { parcel, out, source, built: true };

	}

	#blueprint( outDir, world ) {

		const carried = join( outDir, 'blueprint.json' );
		if ( existsSync( carried ) ) return carried;

		const names = [ `${world}.json`, `city-${world}.json` ];
		if ( world === 'out' ) names.unshift( 'city-urbe.json' );
		if ( world === 'urbe' ) names.unshift( 'city-urbe.json' );

		for ( const name of names ) {

			const path = join( this.atlasDir, name );
			if ( existsSync( path ) ) return path;

		}

		throw new BuildingBuildError( 'E_WORLD_NOT_FOUND', `${world} has no carried blueprint or Atlas sample`, 404 );

	}

	async #build( request ) {

		try {

			await this.build( { ...request, engineRoot: this.engineRoot } );

		} catch ( error ) {

			if ( error instanceof BuildingBuildError ) throw error;
			throw new BuildingBuildError( 'E_BUILD_FAILED', error.message, 500 );

		}

	}

}

function complete( dir, parcel, source ) {

	const exterior = existsSync( join( dir, `${parcel}.blueprint.json` ) ) && existsSync( join( dir, `${parcel}.glb` ) );

	return exterior && ( source === 'shell' || existsSync( join( dir, 'interior', 'building.glb' ) ) );

}

function readJson( path, code, status ) {

	try {

		return JSON.parse( readFileSync( path, 'utf8' ) );

	} catch ( error ) {

		throw new BuildingBuildError( code, `cannot read world blueprint: ${error.message}`, status );

	}

}

function runAssembly( { engineRoot, parcel, source, outDir, blueprintPath } ) {

	return new Promise( ( resolvePromise, reject ) => {

		const args = [
			'run', 'assemble', '--silent', '--',
			'--parcel', parcel,
			'--out', outDir,
			'--blueprint', blueprintPath,
			'--glb', 'merged'
		];
		if ( source === 'interior' ) args.push( '--interior' );
		const child = spawn( 'npm', args, { cwd: engineRoot, stdio: [ 'ignore', 'pipe', 'pipe' ] } );
		let output = '';

		child.stdout.on( 'data', ( chunk ) => output += chunk );
		child.stderr.on( 'data', ( chunk ) => output += chunk );
		child.on( 'error', reject );
		child.on( 'close', ( status ) => {

			if ( status === 0 ) resolvePromise();
			else reject( new Error( output.trim().split( '\n' ).find( ( line ) => line.includes( 'E_' ) ) ?? `assembly exited ${status}` ) );

		} );

	} );

}
