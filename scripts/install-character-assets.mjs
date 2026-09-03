#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CHARACTER_MODELS, HAIRSTYLE_FILES } from '../src/game/agents/CharacterCatalog.js';

const ENGINE_ROOT = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );
const RESOURCES = resolve( process.env.URBE_RESOURCES_DIR ?? join( ENGINE_ROOT, '..', '..', 'resources' ) );
const MODELS = resolve( process.env.URBE_MODELS_DIR ?? join( homedir(), 'models', 'quaternius' ) );

const BASE_ARCHIVE = join( RESOURCES, 'Universal Base Characters[Source]', 'Engine Projects', 'Godot.zip' );
const BASE_LICENSE = join( RESOURCES, 'Universal Base Characters[Source]', 'License_Source.txt' );
const ANIMATION_SOURCE = join( RESOURCES, 'Universal Animation Library[Pro]' );
const BASE_TARGET = join( MODELS, 'universal-base-characters-source' );
const ANIMATION_TARGET = join( MODELS, 'universal-animation-library-pro' );
const ARCHIVE_BASE = 'Godot/quaternius/addons/quaternius/universalbasecharacters';

const BODY_NAMES = CHARACTER_MODELS.map( ( model ) => model.file.replace( /\.gltf$/, '' ) );
const HAIR_FILES = HAIRSTYLE_FILES;
const CHECK_ONLY = process.argv.includes( '--check' );

const GAME_CLIPS = [
	'Walk_Loop', 'Idle_Loop', 'Idle_Talking_Loop',
	'Sitting_Idle_Loop', 'Sitting_Talking_Loop',
	'Crouch_Enter', 'Crouch_Idle_Loop', 'Crouch_Exit',
	'Jump_Start', 'Jump_Loop', 'Jump_Land',
	'Sprint_Enter', 'Sprint_Loop', 'Sprint_Exit'
];

await install();

async function install() {

	await Promise.all(
		[ BASE_ARCHIVE, BASE_LICENSE, join( ANIMATION_SOURCE, 'Unreal-Godot', 'UAL1.glb' ) ]
			.map( ( file ) => readFile( file ) )
	);

	if ( CHECK_ONLY ) {

		await auditInstalled();
		return;

	}

	await mkdir( MODELS, { recursive: true } );

	const temporary = await mkdtemp( join( tmpdir(), 'urbe-characters-' ) );

	try {

		unzip( BASE_ARCHIVE, `${ARCHIVE_BASE}/*`, temporary );
		const stagedBase = join( temporary, 'base' );
		const stagedAnimation = join( temporary, 'animation' );

		await mkdir( stagedBase, { recursive: true } );
		await cp( join( temporary, ARCHIVE_BASE ), stagedBase, { recursive: true, force: true } );
		await cp( BASE_LICENSE, join( stagedBase, 'License.txt' ), { force: true } );
		const repairedImageAliases = await repairImageAliases( stagedBase );

		await mkdir( stagedAnimation, { recursive: true } );
		for ( const file of [ 'UAL1.glb', 'UAL1_RM.glb' ] ) {

			await cp( join( ANIMATION_SOURCE, 'Unreal-Godot', file ), join( stagedAnimation, file ), { force: true } );

		}
		await cp( join( ANIMATION_SOURCE, 'License.txt' ), join( stagedAnimation, 'License.txt' ), { force: true } );
		await cp( join( ANIMATION_SOURCE, 'README_Pro.txt' ), join( stagedAnimation, 'README.txt' ), { force: true } );

		// Validate the complete staged install before replacing a working model
		// store. A broken archive or incompatible hairstyle never removes it.
		const inspected = await inspectAssets( stagedBase, stagedAnimation );

		const manifest = {
			format: 'urbe-character-assets',
			formatVersion: 2,
			baseCharacters: {
				edition: 'Source',
				models: BODY_NAMES,
				hairstyles: HAIR_FILES,
				sha256: await sha256( BASE_ARCHIVE ),
				installedSha256: await treeSha256( stagedBase )
			},
			animations: {
				edition: 'Pro',
				clips: inspected.availableClips.length,
				gameClips: GAME_CLIPS,
				sha256: await sha256( join( ANIMATION_SOURCE, 'Unreal-Godot', 'UAL1.glb' ) ),
				installedSha256: await treeSha256( stagedAnimation )
			},
			rig: { joints: inspected.animationJoints.length, sha256: digest( inspected.animationJoints.join( '\n' ) ) },
			repairedImageAliases
		};

		await rm( BASE_TARGET, { recursive: true, force: true } );
		await rm( ANIMATION_TARGET, { recursive: true, force: true } );
		await cp( stagedBase, BASE_TARGET, { recursive: true, force: true } );
		await cp( stagedAnimation, ANIMATION_TARGET, { recursive: true, force: true } );

		await writeFile( join( MODELS, 'character-assets.json' ), `${JSON.stringify( manifest, null, 2 )}\n` );
		console.log( `Installed ${BODY_NAMES.length} bodies, ${HAIR_FILES.length} hairstyles and ${inspected.availableClips.length} clips in ${MODELS}` );

	} finally {

		await rm( temporary, { recursive: true, force: true } );

	}

}

async function auditInstalled() {

	const manifest = JSON.parse( await readFile( join( MODELS, 'character-assets.json' ), 'utf8' ) );

	if ( manifest.format !== 'urbe-character-assets' || manifest.formatVersion !== 2 ) {

		throw new Error( 'character asset manifest needs a fresh Source/Pro install' );

	}

	const sourceBase = await sha256( BASE_ARCHIVE );
	const sourceAnimation = await sha256( join( ANIMATION_SOURCE, 'Unreal-Godot', 'UAL1.glb' ) );
	if ( manifest.baseCharacters.sha256 !== sourceBase ) throw new Error( 'installed base source archive does not match the workspace original' );
	if ( manifest.animations.sha256 !== sourceAnimation ) throw new Error( 'installed animation source does not match the workspace original' );
	if ( manifest.baseCharacters.installedSha256 !== await treeSha256( BASE_TARGET ) ) throw new Error( 'installed base character files changed after install' );
	if ( manifest.animations.installedSha256 !== await treeSha256( ANIMATION_TARGET ) ) throw new Error( 'installed animation files changed after install' );
	if ( manifest.baseCharacters.models.join( '\n' ) !== BODY_NAMES.join( '\n' ) ) throw new Error( 'installed manifest does not carry every Source body' );
	if ( manifest.baseCharacters.hairstyles.join( '\n' ) !== HAIR_FILES.join( '\n' ) ) throw new Error( 'installed manifest does not carry every Source hairstyle' );

	const inspected = await inspectAssets( BASE_TARGET, ANIMATION_TARGET );
	if ( manifest.rig.sha256 !== digest( inspected.animationJoints.join( '\n' ) ) ) throw new Error( 'installed rig digest does not match the animation skeleton' );

	console.log( `Verified ${BODY_NAMES.length} untouched Source bodies, ${HAIR_FILES.length} hairstyles and ${inspected.availableClips.length} Pro clips in ${MODELS}` );

}

async function inspectAssets( baseRoot, animationRoot ) {

	const animation = glbJson( await readFile( join( animationRoot, 'UAL1.glb' ) ) );
	const animationJoints = jointsOf( animation );
	const availableClips = animation.animations?.map( ( clip ) => clip.name ) ?? [];
	const missing = GAME_CLIPS.filter( ( clip ) => ! availableClips.includes( clip ) );

	if ( missing.length ) throw new Error( `Pro animation library is missing: ${missing.join( ', ' )}` );

	for ( const [ label, file ] of [
		...BODY_NAMES.map( ( name ) => [ name, `${name}.gltf` ] ),
		...HAIR_FILES.map( ( file ) => [ file, file ] )
	] ) {

		const model = JSON.parse( await readFile( join( baseRoot, file ), 'utf8' ) );
		const joints = jointsOf( model );

		if ( joints.join( '\n' ) !== animationJoints.join( '\n' ) ) {

			throw new Error( `${label} skeleton does not match the Pro animation rig` );

		}

	}

	return { animationJoints, availableClips };

}

/**
 * The Source Godot export names some image URIs `*_png.png` while shipping the
 * same file as `*.png`. Material loading must never fall through to Vite's HTML
 * shell, so make the exact aliases named by every glTF and verify each one.
 */
async function repairImageAliases( root ) {

	let repaired = 0;

	for ( const file of await filesBelow( root ) ) {

		if ( ! file.endsWith( '.gltf' ) ) continue;

		const document = JSON.parse( await readFile( file, 'utf8' ) );

		for ( const image of document.images ?? [] ) {

			if ( ! image.uri || image.uri.startsWith( 'data:' ) ) continue;

			const target = resolve( dirname( file ), decodeURIComponent( image.uri ) );
			if ( await exists( target ) ) continue;

			const normalized = basename( target ).replace( /_png\.png$/, '.png' );
			const candidates = [
				target.replace( /_png\.png$/, '.png' ),
				target.replace( /\.png$/, '_png.png' ),
				join( root, basename( target ) ),
				join( root, normalized ),
				join( root, basename( target ).replace( /\.png$/, '_png.png' ) )
			];
			const fallback = await firstExisting( candidates );

			if ( ! fallback ) {

				throw new Error( `${file} references missing image ${image.uri}` );

			}

			await cp( fallback, target, { force: true } );
			repaired ++;

		}

	}

	return repaired;

}

async function firstExisting( paths ) {

	for ( const path of paths ) if ( await exists( path ) ) return path;

	return null;

}

async function filesBelow( root ) {

	const out = [];

	for ( const entry of await readdir( root, { withFileTypes: true } ) ) {

		const path = join( root, entry.name );
		if ( entry.isDirectory() ) out.push( ...await filesBelow( path ) );
		else if ( entry.isFile() ) out.push( path );

	}

	return out;

}

async function treeSha256( root ) {

	const hash = createHash( 'sha256' );
	const files = ( await filesBelow( root ) ).sort();

	for ( const file of files ) {

		hash.update( relative( root, file ) );
		hash.update( '\0' );
		hash.update( await readFile( file ) );

	}

	return hash.digest( 'hex' );

}

async function exists( path ) {

	try {

		await access( path );
		return true;

	} catch {

		return false;

	}

}

function unzip( archive, pattern, destination ) {

	const result = spawnSync( 'unzip', [ '-qq', '-o', archive, pattern, '-d', destination ], { stdio: 'inherit' } );

	if ( result.error ) throw result.error;
	if ( result.status !== 0 ) throw new Error( `unzip exited with ${result.status}` );

}

function glbJson( bytes ) {

	if ( bytes.toString( 'ascii', 0, 4 ) !== 'glTF' ) throw new Error( 'animation file is not a GLB' );

	const jsonLength = bytes.readUInt32LE( 12 );
	return JSON.parse( bytes.subarray( 20, 20 + jsonLength ).toString( 'utf8' ).replace( /\0+$/, '' ) );

}

function jointsOf( gltf ) {

	const skin = gltf.skins?.[ 0 ];

	if ( ! skin ) throw new Error( 'asset has no skeleton' );

	return skin.joints.map( ( index ) => gltf.nodes[ index ]?.name ?? '' );

}

async function sha256( file ) {

	return digest( await readFile( file ) );

}

function digest( data ) {

	return createHash( 'sha256' ).update( data ).digest( 'hex' );

}
