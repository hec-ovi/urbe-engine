/**
 * The atlas blueprint reduced to what a top-down map needs: city bounds, the
 * street centrelines with their widths, block outlines and active transit.
 * Plain [x, z] arrays keep the UI independent of Atlas and Connections.
 */
export function mapModel( atlas, networks ) {

	return {
		bounds: atlas.meta.bounds,
		roads: atlas.streets.edges.map( ( edge ) => ( { path: edge.path, width: edge.width } ) ),
		blocks: atlas.volumetric.ground
			.filter( ( cover ) => cover.surface === 'block' )
			.map( ( cover ) => cover.polygon ),
		transit: transitModel( atlas, networks, ( [ x, , z ] ) => [ x, z ] )
	};

}

/** The city as blocks and exact 3D transit paths for the full map. */
export function blockWorld( atlas, networks ) {

	return {
		bounds: atlas.meta.bounds,
		buildings: atlas.volumetric.buildings.map( ( building ) => ( { ring: building.footprint, height: building.height } ) ),
		ground: atlas.volumetric.ground,
		transit: transitModel( atlas, networks, ( point ) => [ ...point ] )
	};

}

/** Only places served by the generated route set belong on the maps. */
function transitModel( atlas, networks, project ) {

	const routes = networks.transit.routes.map( ( route ) => ( {
		id: route.id,
		kind: route.kind,
		path: route.shape.map( project )
	} ) );
	const stations = {
		subway: new Map( atlas.transit.subwayStations.map( ( station ) => [ station.id, station ] ) ),
		train: new Map( atlas.transit.trainStations.map( ( station ) => [ station.id, station ] ) )
	};
	const places = [];
	const placed = new Set();

	for ( const route of networks.transit.routes ) {

		for ( const stop of route.stops ) {

			const key = `${route.kind}:${stop.stopId}`;
			if ( placed.has( key ) ) continue;

			placed.add( key );
			if ( route.kind === 'bus' ) {

				places.push( { id: key, refId: stop.stopId, kind: route.kind, point: project( [ stop.x, stop.y, stop.z ] ) } );
				continue;

			}

			const station = stations[ route.kind ].get( stop.stopId );
			if ( ! station ) continue;

			const entries = station.entrances.length
				? station.entrances.map( ( [ x, z ] ) => [ x, 0, z ] )
				: [ [ station.position[ 0 ], station.level, station.position[ 1 ] ] ];
			entries.forEach( ( point, index ) => places.push( {
				id: `${key}:${index}`,
				refId: stop.stopId,
				kind: route.kind,
				point: project( point )
			} ) );

		}

	}

	return { routes, places };

}
