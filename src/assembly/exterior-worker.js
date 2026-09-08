import { parentPort } from 'node:worker_threads';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generate } from '../../../exterior/src/index.ts';

parentPort.on( 'message', async ( { id, request, outDir } ) => {
	try {
		const { blueprint, glb } = await generate( request, { textures: { mode: 'keys' } } );
		await mkdir( outDir, { recursive: true } );
		await writeFile( join( outDir, `${request.buildingId}.glb` ), glb );
		await writeFile( join( outDir, `${request.buildingId}.blueprint.json` ), JSON.stringify( blueprint, null, 2 ) + '\n' );
		parentPort.postMessage( { id, blueprint } );
	} catch ( error ) {
		parentPort.postMessage( { id, error: `${error.code ?? error.name}: ${error.message}` } );
	}
} );
