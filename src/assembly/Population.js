import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The population a world's opened interiors hold, counted from the capacity
 * each one publishes in its npc.json (../interior/CONTRACT.md): every
 * dwelling's sleepers are its residents, every post times its shifts a job.
 * Nobody sets this figure; the simulation counts the same people at runtime
 * (../simulation/CONTRACT.md, rules 3).
 * @param outDir the world's directory
 * @param interiorIds the parcels whose interiors stand
 */
export function countedPopulation( outDir, interiorIds ) {

	const counted = { interiors: 0, dwellings: 0, beds: 0, residents: 0, posts: 0, jobs: 0 };
	for ( const id of interiorIds ) {

		const file = join( outDir, id, 'interior', 'npc.json' );
		if ( ! existsSync( file ) ) continue;
		const capacity = JSON.parse( readFileSync( file, 'utf8' ) ).capacity;
		if ( ! capacity ) continue;
		counted.interiors ++;
		for ( const dwelling of capacity.dwellings ) {

			counted.dwellings ++;
			counted.beds += dwelling.beds;
			counted.residents += dwelling.sleepers;

		}
		for ( const post of capacity.posts ) {

			counted.posts += post.posts;
			counted.jobs += post.posts * post.shifts.length;

		}

	}
	return counted;

}
