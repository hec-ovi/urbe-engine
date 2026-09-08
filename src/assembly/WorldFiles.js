import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashJson, writeWorldArchive } from '../world-archive/index.js';
import { sha256, writeJsonFile } from './JsonFile.js';

/** Prepares world documents before replacing any published file or manifest. */
export class WorldFiles {

	constructor( directory ) {

		this.directory = directory;
		this.stage = mkdtempSync( join( directory, '.world-archive-' ) );
		this.names = [];

	}

	async prepare( atlas, connectionsArtifact, { encoding, archiveOptions, catalog } ) {

		const references = encoding === 'archive'
			? await this.#archives( atlas, connectionsArtifact, archiveOptions )
			: this.#json( atlas, connectionsArtifact );
		if ( catalog ) {

			await writeWorldArchive( catalog, join( this.stage, 'shells' ), archiveOptions );
			this.names.push( 'shells' );
			references.shellCatalog = archiveReference( this.stage, 'shells' );

		}
		return references;

	}

	#json( atlas, connectionsArtifact ) {

		const references = connectionsArtifact ? { connections: connectionsArtifact.referenceFor( hashJson( atlas ) ) } : {};
		writeJsonFile( join( this.stage, 'blueprint.json' ), atlas );
		this.names.push( 'blueprint.json' );
		if ( connectionsArtifact ) {

			connectionsArtifact.write( this.stage );
			this.names.push( 'connections.json' );

		}
		return references;

	}

	async #archives( atlas, connectionsArtifact, options ) {

		const blueprintDirectory = join( this.stage, 'blueprint' );
		const index = await writeWorldArchive( atlas, blueprintDirectory, options );
		connectionsArtifact?.referenceFor( index.json );
		const blueprint = archiveReference( this.stage, 'blueprint' );
		this.names.push( 'blueprint' );
		if ( ! connectionsArtifact ) return { blueprint };

		await connectionsArtifact.writeArchive( join( this.stage, 'connections' ), options );
		this.names.push( 'connections' );
		return {
			blueprint,
			connections: { ...archiveReference( this.stage, 'connections' ), blueprintSha256: blueprint.sha256 }
		};

	}

	/** Roll back document replacements if publication cannot finish. */
	publish( manifest ) {

		const pending = join( this.stage, 'manifest.json' );
		writeFileSync( pending, JSON.stringify( manifest, null, 2 ) + '\n' );
		const replaced = [];
		try {

			for ( const name of this.names ) {

				const destination = join( this.directory, name );
				const backup = join( this.stage, `previous-${name}` );
				if ( existsSync( destination ) ) renameSync( destination, backup );
				replaced.push( { destination, backup } );
				renameSync( join( this.stage, name ), destination );

			}
			renameSync( pending, join( this.directory, 'manifest.json' ) );

		} catch ( error ) {

			for ( const { destination, backup } of replaced.reverse() ) {

				rmSync( destination, { recursive: true, force: true } );
				if ( existsSync( backup ) ) renameSync( backup, destination );

			}
			throw error;

		}

	}

	dispose() { rmSync( this.stage, { recursive: true, force: true } ); }

}

function archiveReference( directory, name ) {

	return { file: `${name}/index.json`, encoding: 'archive', sha256: sha256( readFileSync( join( directory, name, 'index.json' ) ) ) };

}
