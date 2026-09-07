import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Ajv from 'ajv/dist/2020.js';
import schema from './report.schema.json' with { type: 'json' };

/** Development-only local storage for the running game's timing reports. */
export function hitchReportPlugin( directory ) {

	const valid = new Ajv().compile( schema );
	const reports = [];
	let pending = Promise.resolve();
	return {
		name: 'game-performance-reports',
		configureServer( server ) {

			server.ws.on( 'urbe:performance', report => {

				if ( ! valid( report ) ) return;
				reports.push( report );
				if ( reports.length > 60 ) reports.shift();
				pending = pending.then( async () => {

					await mkdir( directory, { recursive: true } );
					await writeFile( join( directory, 'performance.json' ), JSON.stringify( reports ) + '\n' );

				} ).catch( error => server.config.logger.warn( `performance report: ${error.message}` ) );

			} );

		}
	};

}
