import { Rng } from '../../city/Rng.js';
import { PropModels } from './PropModels.js';
import { Sites } from './Sites.js';
import { Clearance } from './Clearance.js';
import { Arrangements } from './Arrangements.js';
import { AuthoredRails } from './AuthoredRails.js';
import { seedOf } from './Placement.js';

/** One source-ordered placement plan owns mutual clearance across every window. */
export async function planDressing( atlas, walk, factory, options ) {
	const models = await new PropModels( factory, options.loadAsset ).load();
	try {
		const clearance = new Clearance( atlas, walk, options.obstacles ), arrange = new Arrangements( models );
		const placements = new AuthoredRails( atlas, models ).build();
		for ( const rail of placements ) clearance.block( rail.footprint, rail.bottom, rail.top, 0.12 );
		for ( const site of new Sites( atlas ).all() ) {
			const items = arrange.at( site, new Rng( seedOf( `${atlas.meta.seed}:${site.id}` ) ) );
			if ( ! items.length ) continue;
			const elevation = clearance.claim( items, site.kind === 'yard' );
			if ( elevation === null ) continue;
			for ( const item of items ) { item.matrix.elements[ 13 ] += elevation; item.bottom += elevation; item.top += elevation; placements.push( item ); }
		}
		const counts = { total: placements.length, guardrail: 0 };
		for ( const spec of models.models.values() ) counts[ spec.kind ] = 0;
		for ( const item of placements ) counts[ item.kind ] ++;
		return { models, placements, counts };
	} catch ( error ) { models.dispose(); throw error; }
}
