import { lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ExteriorBuildBoundary, ExteriorBuildError, blueprintHash } from './ExteriorBuildBoundary.js';
import { ExteriorBatchProcess } from './ExteriorBatchProcess.js';

export class ExteriorBuildService {

	#jobs = new Map();
	#tail = Promise.resolve();

	constructor( { engineRoot, process = new ExteriorBatchProcess(), maxJobs = 4 } ) {

		this.engineRoot = resolve( engineRoot );
		this.process = process;
		this.maxJobs = maxJobs;
		this.boundary = new ExteriorBuildBoundary();

	}

	capability() { return this.process.capability( this.engineRoot ); }

	start( input ) {

		this.boundary.check( input );
		if ( this.#jobs.size >= this.maxJobs ) throw new ExteriorBuildError( 'E_BUSY', 'this server session has reached its exterior job limit', 429 );
		const capability = this.capability();
		if ( ! capability.available ) throw new ExteriorBuildError( 'E_UNAVAILABLE', capability.reason, 503 );
		const blueprint = structuredClone( input.blueprint );
		let outDir;
		try {

			const root = join( this.engineRoot, 'out' );
			mkdirSync( root, { recursive: true } );
			if ( ! lstatSync( root ).isDirectory() || lstatSync( root ).isSymbolicLink() ) throw new Error( 'output root must be a real directory' );
			outDir = mkdtempSync( join( root, 'atlas-exteriors-' ) );
			writeFileSync( join( outDir, 'blueprint.json' ), JSON.stringify( blueprint ), { flag: 'wx' } );

		} catch ( error ) { throw new ExteriorBuildError( 'E_STORAGE', error.message ); }
		const id = basename( outDir );
		const job = { id, blueprintHash: blueprintHash( blueprint ), state: 'queued', out: `/out/${id}`, total: blueprint.parcels.length, completed: 0, completedParcels: [], manifest: null, error: null };
		const record = { job, blueprint, parcelIds: blueprint.parcels.map( ( p ) => p.id ), outDir };
		this.#jobs.set( id, record );
		this.#tail = this.#tail.then( () => this.#run( record ) );
		return structuredClone( job );

	}

	get( id ) {

		const record = this.#jobs.get( id );
		if ( ! record ) throw new ExteriorBuildError( 'E_JOB_NOT_FOUND', 'exterior job was not found in this server session', 404 );
		this.#progress( record );
		return structuredClone( record.job );

	}

	#progress( { job, parcelIds, outDir } ) {

		job.completedParcels = parcelIds.filter( ( id ) =>
			realDirectory( join( outDir, id ) ) && nonemptyFile( join( outDir, id, `${id}.glb` ) ) && validJsonFile( join( outDir, id, `${id}.blueprint.json` ) ) );
		job.completed = job.completedParcels.length;

	}

	async #run( record ) {

		const { job, outDir, blueprint } = record;
		job.state = 'running';
		try {

			await this.process.run( { engineRoot: this.engineRoot, blueprintPath: join( outDir, 'blueprint.json' ), outDir } );
			this.#progress( record );
			let manifest;
			try {

				manifest = JSON.parse( readFileSync( join( outDir, 'manifest.json' ), 'utf8' ) );
				const carried = JSON.parse( readFileSync( join( outDir, 'blueprint.json' ), 'utf8' ) );
				if ( ! this.boundary.manifest( manifest ) || manifest.seed !== blueprint.meta.seed || manifest.atlasVersion !== blueprint.meta.version ||
					! isDeepStrictEqual( [ ...manifest.parcels ].sort(), blueprint.parcels.map( ( p ) => p.id ).sort() ) ||
					manifest.interiors.length || Object.keys( manifest.floors ).length || job.completed !== job.total || ! isDeepStrictEqual( carried, blueprint ) ) throw new Error( 'batch artifacts do not match the requested blueprint and complete shell set' );

			} catch ( error ) { throw new ExteriorBuildError( 'E_BUILD_INCOMPLETE', error.message ); }
			job.manifest = manifest;
			job.state = 'succeeded';

		} catch ( error ) {

			this.#progress( record );
			job.state = 'failed';
			job.error = { code: error instanceof ExteriorBuildError ? error.code : 'E_BUILD_FAILED', message: error.message };

		} finally { record.blueprint = null; }

	}

}

function realDirectory( path ) {

	try { return lstatSync( path ).isDirectory(); } catch { return false; }

}

function nonemptyFile( path ) {

	try { const stat = lstatSync( path ); return stat.isFile() && stat.size > 0; } catch { return false; }

}

function validJsonFile( path ) {

	if ( ! nonemptyFile( path ) ) return false;
	try { const value = JSON.parse( readFileSync( path, 'utf8' ) ); return value !== null && typeof value === 'object'; } catch { return false; }

}
