import { GroundMarkings } from '../ground/GroundMarkings.js';
import { LaneDebug } from './LaneDebug.js';

/** Selects the normal ground paint or the explicitly requested lane diagnostic. */
export class StreetMarkings {

	static async build( atlas, networks, factory, resolver, mode ) {

		if ( mode === 'debug' || mode === 'glow' ) return new LaneDebug( networks, mode ).build();
		const bindings = await resolver.loadBindings( 'street-markings' );
		return new GroundMarkings( atlas, networks.road, factory, bindings ).build().group;

	}

}
