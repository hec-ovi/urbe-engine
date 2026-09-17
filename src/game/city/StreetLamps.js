import { StreetLampPlan } from './StreetLampPlan.js';
import { StreetLampInstances } from './StreetLampInstances.js';
import { StreetLampStream } from './StreetLampStream.js';

export { samplePath } from './StreetLampPlan.js';
export { streetLampAssembly, WALL_LUMENS } from './StreetLampModel.js';

/** Authored post and facade fixtures, with complete or spatial scene admission. */
export class StreetLamps {

	constructor( atlas, factory, walk = null ) { this.atlas = atlas; this.factory = factory; this.walk = walk; }

	/**
	 * Where this world's street fixtures stand and what they emit, planned
	 * without building any of their models: `{ records, posts, glows }`.
	 */
	static plan( atlas, walk = null ) {

		const plan = new StreetLampPlan( atlas, walk );
		for ( const _ of plan.steps() ) { /* Complete source planning. */ }
		return plan;

	}

	build() {

		const plan = StreetLamps.plan( this.atlas, this.walk );
		const models = new StreetLampInstances( this.factory );
		const group = models.build( plan.records );
		group.name = 'lamps';
		return { group, posts: plan.posts, glows: plan.glows, dispose: () => { models.release( group ); models.dispose(); } };

	}

	stream( options ) { return new StreetLampStream( this.atlas, this.factory, this.walk, options ); }

}
