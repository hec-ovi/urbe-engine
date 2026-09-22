/** Producer adapter for a paired standalone building. Run under tsx in a worker process. */
import { copyFileSync, readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { runInterior } from '../assembly/interiorRunner.js';
import { InteriorModules } from '../assembly/InteriorModules.js';
import { validateExteriorRequest } from '../assembly/validators.js';
import { PreviewRevision, previewState, sha256 } from './PreviewRevision.js';

const ENGINE_ROOT = fileURLToPath( new URL( '../..', import.meta.url ) );

/** Stage the complete pair before replacing any currently published building. */
export async function buildPairedPreview( {
	engineRoot = ENGINE_ROOT, directory, parcel,
	generateExterior = async request => ( await import( new URL( '../../../exterior/src/index.ts', import.meta.url ).href ) ).generate( request, { textures: { mode: 'keys' } } ),
	generateInterior = runInterior,
	publishResources = () => new InteriorModules().publish()
} ) {

	const requestPath = join( directory, `${parcel}.request.json` );
	const requestBytes = readFileSync( requestPath );
	const request = JSON.parse( requestBytes );
	const errors = validateExteriorRequest( request );
	if ( errors.length || request.buildingId !== parcel ) throw new Error( 'E_INVALID_REQUEST: invalid exterior request or building id' );
	const fingerprint = new PreviewRevision( engineRoot );
	const revisions = fingerprint.current();
	const sharedDir = process.env.URBE_SHARED_DIR || join( engineRoot, 'out/shared' );
	const state = previewState( directory, parcel, revisions, { sharedDir, fingerprint } );
	if ( state.complete ) return { parcel, built: false };

	const staged = mkdtempSync( join( dirname( directory ), `.${parcel}-staging-` ) );
	try {

		writeFileSync( join( staged, `${parcel}.request.json` ), requestBytes );
		const blueprintPath = join( staged, `${parcel}.blueprint.json` );
		const shellPath = join( staged, `${parcel}.glb` );
		let blueprint;
		if ( state.exteriorFresh ) {

			copyFileSync( join( directory, `${parcel}.blueprint.json` ), blueprintPath );
			copyFileSync( join( directory, `${parcel}.glb` ), shellPath );
			blueprint = JSON.parse( readFileSync( blueprintPath ) );

		} else {

			const result = await generateExterior( request );
			blueprint = result.blueprint;
			writeFileSync( shellPath, result.glb );
			writeFileSync( blueprintPath, JSON.stringify( blueprint ) + '\n' );

		}
		const interiorDir = join( staged, 'interior' );
		mkdirSync( interiorDir );
		const building = await generateInterior( {
			seed: request.seed, building: { id: parcel, type: request.building.type, tier: request.building.tier },
			blueprint, materialTheme: request.theme
		}, interiorDir );
		const resources = await publishResources();
		writeFileSync( join( staged, 'preview.json' ), JSON.stringify( {
			version: 2, architecture: blueprint.assembly?.architecture ?? 'ordinary', revisions,
			requestSha256: sha256( requestBytes ),
			exteriorSha256: sha256( readFileSync( blueprintPath ) ), shellSha256: sha256( readFileSync( shellPath ) ),
			interiorModules: resources.modules, interiorProps: resources.props
		}, null, 2 ) + '\n' );
		if ( ! previewState( staged, parcel, revisions, { sharedDir, fingerprint } ).complete ) {

			throw new Error( 'E_BUILD_INCOMPLETE: paired building lacks matching floors, layouts, NPC data or shared assets' );

		}
		// An edit while the worker is running must never mark mixed code as current.
		if ( ! isDeepStrictEqual( revisions, fingerprint.current() ) ) throw new Error( 'E_BUILD_INCOMPLETE: producer sources changed during the build; retry' );
		publishPair( staged, directory );
		return { parcel, built: true, exteriorBuilt: ! state.exteriorFresh,
			architecture: building.architecture, floors: building.floors.length, layouts: Object.keys( building.layouts ) };

	} finally { rmSync( staged, { recursive: true, force: true } ); }

}

/** No producer awaits between removal of the old name and promotion; failed promotion rolls back. */
function publishPair( staged, directory ) {

	const previous = mkdtempSync( join( dirname( directory ), `.${directory.split( /[\\/]/ ).at( - 1 )}-previous-` ) );
	rmSync( previous, { recursive: true } );
	const hadPrevious = existsSync( directory );
	if ( hadPrevious ) renameSync( directory, previous );
	try { renameSync( staged, directory ); }
	catch ( error ) {

		if ( hadPrevious ) renameSync( previous, directory );
		throw error;

	}
	rmSync( previous, { recursive: true, force: true } );

}

if ( process.argv[ 1 ] && pathToFileURL( resolve( process.argv[ 1 ] ) ).href === import.meta.url ) {

	const [ directory, parcel ] = process.argv.slice( 2 );
	console.log( JSON.stringify( await buildPairedPreview( { directory, parcel } ) ) );

}
