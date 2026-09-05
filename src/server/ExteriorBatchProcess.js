import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export class ExteriorBatchProcess {

	capability( engineRoot ) {

		const required = [
			'src/assembly/city-cli.js', 'node_modules/.bin/tsx',
			'../connections/src/index.ts', '../exterior/package.json',
			'../exterior/node_modules', '../interior/dist/feasibility.js'
		];
		const missing = required.filter( ( path ) => ! existsSync( join( engineRoot, path ) ) );
		return { contractVersion: '1.0', available: missing.length === 0, reason: missing.length ? `Missing batch runtime: ${missing.join( ', ' )}` : null };

	}

	run( { engineRoot, blueprintPath, outDir } ) {

		return new Promise( ( resolve, reject ) => {

			const child = spawn( 'npm', [ 'run', 'assemble-city', '--silent', '--', '--blueprint', blueprintPath, '--out', outDir, '--interiors', '0' ], { cwd: engineRoot, stdio: [ 'ignore', 'pipe', 'pipe' ] } );
			let tail = '';
			const record = ( chunk ) => { tail = ( tail + chunk ).slice( - 16384 ); };
			child.stdout.on( 'data', record );
			child.stderr.on( 'data', record );
			child.on( 'error', reject );
			child.on( 'close', ( status ) => status === 0 ? resolve() : reject( new Error( tail.trim() || `assembly exited ${status}` ) ) );

		} );

	}

}
