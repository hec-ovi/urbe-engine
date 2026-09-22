import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { doorFrames } from '../src/game/city/DoorGeometry.js';

/** Add navigable links and exact producer door coordinates to a review report. */
export async function annotateReview( directory ) {
	const path = join( directory, 'review.json' );
	const report = JSON.parse( await readFile( path, 'utf8' ) );
	const playUrl = new URL( report.playUrl );
	const out = playUrl.searchParams.get( 'out' );
	for ( const entry of report.buildings ) {
		const blueprint = JSON.parse( await readFile( join( directory, entry.parcelId, `${entry.parcelId}.blueprint.json` ), 'utf8' ) );
		const door = doorFrames( blueprint ).find( frame => frame.floor === 0 && frame.role === 'main' );
		if ( ! door ) throw new Error( `${entry.parcelId} has no published main entrance.` );
		entry.entrance = { position: door.center.toArray(), outside: door.outside.toArray(), normal: door.normal.toArray() };
		const preview = new URL( '/', playUrl );
		preview.search = new URLSearchParams( { mode: 'building', parcel: entry.parcelId, out, source: 'interior', view: 'walk', brightness: '8' } ).toString();
		entry.interiorUrl = preview.href;
	}
	await writeFile( path, JSON.stringify( report, null, 2 ) + '\n' );
	return report;
}
