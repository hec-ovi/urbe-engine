import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs( { options: { source: { type: 'string' }, models: { type: 'string' }, check: { type: 'boolean' } } } );
const catalog = JSON.parse( await readFile( new URL( './catalog.json', import.meta.url ), 'utf8' ) );
const root = resolve( values.models ?? process.env.URBE_MODELS_DIR ?? join( homedir(), 'models', 'quaternius' ) );
if ( ! values.check && ! values.source ) throw new Error( 'Provide --source <downloads>, or --check to audit installed models.' );
const destination = join( root, 'street-props' );
if ( ! values.check ) await mkdir( destination, { recursive: true } );
const files = [];
for ( const asset of catalog.assets ) {
	const input = values.check ? join( destination, asset.file ) : join( resolve( values.source ), asset.file );
	const bytes = await readFile( input );
	if ( bytes.toString( 'ascii', 0, 4 ) !== 'glTF' || bytes.readUInt32LE( 4 ) !== 2 || bytes.readUInt32LE( 8 ) !== bytes.length ) throw new Error( `Invalid GLB: ${asset.file}` );
	const json = JSON.parse( bytes.toString( 'utf8', 20, 20 + bytes.readUInt32LE( 12 ) ) );
	if ( ! json.meshes?.length ) throw new Error( `No meshes: ${asset.file}` );
	if ( ! values.check ) await copyFile( input, join( destination, asset.file ) );
	files.push( { id: asset.id, file: asset.file, bytes: bytes.length, source: json.asset?.extras?.source ?? null } );
}
console.log( JSON.stringify( { ok: true, files }, null, 2 ) );
