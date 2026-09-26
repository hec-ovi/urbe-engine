import { parentPort } from 'node:worker_threads';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { generate } from '../../../exterior/src/index.ts';
import { replaceFile } from './JsonFile.js';

// Only programs read a blueprint, so it is written compact. Each file replaces
// its name whole, so a world cloned by hard links never sees this write.
parentPort.on( 'message', async ( { id, request, outDir } ) => {
	try {
		const { blueprint, glb } = await generate( request, { textures: { mode: 'keys' } } );
		mkdirSync( outDir, { recursive: true } );
		replaceFile( join( outDir, `${request.buildingId}.glb` ), glb );
		replaceFile( join( outDir, `${request.buildingId}.blueprint.json` ), JSON.stringify( blueprint ) + '\n' );
		parentPort.postMessage( { id, blueprint } );
	} catch ( error ) {
		parentPort.postMessage( { id, error: `${error.code ?? error.name}: ${error.message}` } );
	}
} );
