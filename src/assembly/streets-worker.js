import { parentPort } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildStreetArtifacts } from './StreetArtifacts.js';

parentPort.on( 'message', async ( { stage, options } ) => {
	try {
		const atlas = JSON.parse( await readFile( join( stage, 'blueprint.json' ), 'utf8' ) );
		parentPort.postMessage( { reference: await buildStreetArtifacts( stage, atlas, options ) } );
	} catch ( error ) {
		parentPort.postMessage( { error: `${error.code ?? error.name}: ${error.message}` } );
	}
} );
