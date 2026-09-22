/** Content identity of the producers and the complete pair they publish. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ignored = /(?:^|\/)(?:node_modules|\.git|ui|__tests__|tests)(?:\/|$)|\.(?:test|spec)\.[^/]+$|\.md$|\.d\.ts$/;

/** Rechecks file metadata on every request; unchanged files do not get reread. */
export class PreviewRevision {

	#files = new Map();

	constructor( engineRoot, env = process.env ) {

		this.engineRoot = resolve( engineRoot );
		this.repoRoot = dirname( this.engineRoot );
		this.env = env;

	}

	fileHash( path ) {

		const stat = statSync( path, { bigint: true } );
		const signature = `${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.ino}`;
		const cached = this.#files.get( path );
		if ( cached?.signature === signature ) return cached.hash;
		const hash = sha256( readFileSync( path ) );
		this.#files.set( path, { signature, hash } );
		return hash;

	}

	current() {

		const engine = this.engineRoot;
		const exterior = join( this.repoRoot, 'exterior' );
		const siblingInterior = join( this.repoRoot, 'interior' );
		const interior = this.env.URBE_INTERIOR_DIR ? resolve( engine, this.env.URBE_INTERIOR_DIR ) : siblingInterior;
		const materials = this.env.URBE_MATERIALS_DIR ? resolve( engine, this.env.URBE_MATERIALS_DIR ) : join( this.repoRoot, 'materials' );
		const props = this.env.URBE_INTERIOR_PROPS_DIR ? resolve( engine, this.env.URBE_INTERIOR_PROPS_DIR ) : join( siblingInterior, 'src/assets' );
		const themes = existsSync( join( materials, 'themes' ) )
			? readdirSync( join( materials, 'themes' ), { withFileTypes: true } ).filter( entry => entry.isDirectory() ).map( entry => join( materials, 'themes', entry.name, 'theme.json' ) ).sort() : [];
		const common = [
			join( engine, 'package.json' ), join( engine, 'package-lock.json' ),
			join( engine, 'src/building/build-preview.js' ), join( engine, 'src/building/PreviewRevision.js' ),
			join( engine, 'src/assembly/validators.js' ), join( engine, 'src/assembly/SchemaFiles.js' ),
			join( this.repoRoot, 'materials/bindings' ), join( materials, 'schema' ), ...themes
		];
		return {
			exterior: this.#digest( [ ...common,
				join( exterior, 'src' ), join( exterior, 'schemas' ), join( exterior, 'package.json' ), join( exterior, 'package-lock.json' ),
				join( exterior, 'assets/native/bindings.json' ), join( exterior, 'public/native-materials/themes/cyberpunk/theme.json' ),
				// Exterior's core preflight imports the sibling Interior feasibility build.
				join( siblingInterior, 'dist' ), join( siblingInterior, 'schemas/core-feasibility.json' )
			] ),
			interior: this.#digest( [ ...common,
				join( interior, 'src' ), join( interior, 'schemas' ), join( interior, 'package.json' ), join( interior, 'package-lock.json' ), props,
				join( engine, 'src/assembly/interiorRunner.js' ), join( engine, 'src/assembly/InteriorModules.js' ),
				join( engine, 'src/assembly/SharedResources.js' ), join( engine, 'src/assembly/JsonFile.js' ),
				...( this.env.URBE_INTERIOR_MODULES_DIR ? [ resolve( engine, this.env.URBE_INTERIOR_MODULES_DIR ) ] : [] )
			] )
		};

	}

	#digest( roots ) {

		const hash = createHash( 'sha256' );
		for ( const [ index, root ] of roots.entries() ) {

			hash.update( `${index}\0` );
			if ( ! existsSync( root ) ) { hash.update( 'missing\0' ); continue; }
			const files = statSync( root ).isDirectory() ? sourceFiles( root ) : [ root ];
			for ( const path of files ) hash.update( `${relative( root, path ).split( sep ).join( '/' )}\0${this.fileHash( path )}\0` );

		}
		return hash.digest( 'hex' );

	}

}

/** The shell can be reused only when its own source revision and original inputs match. */
export function previewState( directory, parcel, revisions, { sharedDir, fingerprint } = {} ) {

	const hashFile = path => fingerprint ? fingerprint.fileHash( path ) : sha256( readFileSync( path ) );
	let exteriorFresh = false;
	try {

		const preview = readJson( join( directory, 'preview.json' ) );
		const blueprintPath = join( directory, `${parcel}.blueprint.json` );
		exteriorFresh = preview.revisions?.exterior === revisions.exterior
			&& preview.requestSha256 === hashFile( join( directory, `${parcel}.request.json` ) )
			&& preview.exteriorSha256 === hashFile( blueprintPath )
			&& preview.shellSha256 === hashFile( join( directory, `${parcel}.glb` ) );
		if ( ! exteriorFresh || preview.revisions?.interior !== revisions.interior ) return { exteriorFresh, complete: false };
		const blueprint = readJson( blueprintPath );
		const building = readJson( join( directory, 'interior/building.json' ) );
		const expectedFloors = blueprint.floors.filter( floor => floor.index >= 0 );
		const floorIndices = building.floors?.map( floor => floor.index );
		if ( building.buildingId !== parcel || ! expectedFloors.length || floorIndices?.length !== expectedFloors.length
			|| ! expectedFloors.every( floor => floorIndices.includes( floor.index ) )
			|| ! building.layouts || ! Object.keys( building.layouts ).length
			|| ! building.floors.every( floor => typeof building.layouts[ floor.layout ] === 'string' ) ) return { exteriorFresh, complete: false };
		for ( const file of Object.values( building.layouts ) ) readJson( localFile( join( directory, 'interior' ), file ) );
		readJson( join( directory, 'interior/npc.json' ) );
		for ( const [ reference, collection, fileKey ] of [
			[ preview.interiorModules, 'modules', 'file' ], [ preview.interiorProps, 'assets', 'modelUri' ]
		] ) {

			const root = localFile( sharedDir, reference.shared );
			const catalogPath = localFile( root, reference.file );
			if ( hashFile( catalogPath ) !== reference.sha256 ) return { exteriorFresh, complete: false };
			const catalog = readJson( catalogPath );
			if ( ! Array.isArray( catalog[ collection ] ) ) return { exteriorFresh, complete: false };
			for ( const entry of catalog[ collection ] ) if ( entry[ fileKey ] && ! statSync( localFile( root, entry[ fileKey ] ) ).isFile() ) return { exteriorFresh, complete: false };

		}
		return { exteriorFresh, complete: true };

	} catch { return { exteriorFresh, complete: false }; }

}

export function sha256( bytes ) { return createHash( 'sha256' ).update( bytes ).digest( 'hex' ); }

function readJson( path ) { return JSON.parse( readFileSync( path, 'utf8' ) ); }

function localFile( directory, path ) {

	if ( typeof path !== 'string' || ! path || ! directory ) throw new Error( 'Missing local resource path' );
	const target = resolve( directory, path );
	if ( ! target.startsWith( resolve( directory ) + sep ) ) throw new Error( 'Resource path escapes its directory' );
	return target;

}

function sourceFiles( directory ) {

	const files = [];
	for ( const entry of readdirSync( directory, { withFileTypes: true } ).sort( ( a, b ) => a.name < b.name ? - 1 : a.name > b.name ? 1 : 0 ) ) {

		const path = join( directory, entry.name );
		if ( ignored.test( path.split( sep ).join( '/' ) ) ) continue;
		if ( entry.isDirectory() ) files.push( ...sourceFiles( path ) );
		else if ( entry.isFile() ) files.push( path );

	}
	return files;

}
