import { StreetLampPlan } from './StreetLampPlan.js';
import { StreetLampInstances } from './StreetLampInstances.js';
import { StreetLampStream } from './StreetLampStream.js';

export { samplePath } from './StreetLampPlan.js';
export { streetLampAssembly, WALL_LUMENS } from './StreetLampModel.js';

/** Authored post and facade fixtures, with complete or spatial scene admission. */
export class StreetLamps {

	constructor( atlas, factory, walk = null ) { this.atlas = atlas; this.factory = factory; this.walk = walk; }

	build() {

		const plan = new StreetLampPlan( this.atlas, this.walk );
		for ( const _ of plan.steps() ) { /* Complete source planning. */ }
		const models = new StreetLampInstances( this.factory );
		const group = models.build( plan.records );
		group.name = 'lamps';
		return { group, posts: plan.posts, glows: plan.glows, dispose: () => { models.release( group ); models.dispose(); } };

	}

	stream( options ) { return new StreetLampStream( this.atlas, this.factory, this.walk, options ); }

}
