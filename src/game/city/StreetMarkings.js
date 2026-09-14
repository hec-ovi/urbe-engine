import { GroundMarkings } from '../ground/GroundMarkings.js';
import { LaneDebug } from './LaneDebug.js';
import { Group } from 'three/webgpu';

/** Selects the normal ground paint or the explicitly requested lane diagnostic. */
export class StreetMarkings {

	static async build( atlas, networks, factory, resolver, mode, native = false ) {

		if ( mode === 'debug' || mode === 'glow' ) return new LaneDebug( networks, mode ).build();
		let road = networks.road;
		if ( native ) {
			const highwayIds = new Set( atlas.streets.edges.filter( edge => edge.class === 'highway' ).map( edge => edge.id ) );
			if ( ! highwayIds.size ) return new Group();
			road = { ...road, lanes: road.lanes.filter( lane => highwayIds.has( lane.edgeId ) ) };
			atlas = { ...atlas, streets: { ...atlas.streets, crossings: ( atlas.streets.crossings ?? [] ).map( crossing => ( {
				...crossing, segments: crossing.segments.filter( segment => highwayIds.has( segment.edgeId ) )
			} ) ).filter( crossing => crossing.segments.length ) } };
		}
		const bindings = await resolver.loadBindings( 'street-markings' );
		return new GroundMarkings( atlas, road, factory, bindings ).build().group;

	}

}
