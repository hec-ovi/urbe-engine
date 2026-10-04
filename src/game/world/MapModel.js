import { districtLabel } from './Locator.js';

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

/**
 * The city as blocks and exact 3D transit paths for the full map, with each
 * named street's centrelines (`streetOf( edgeId )`, Quests StreetNames, names
 * the grid's streets and avenues; alleys and the highway go unnamed) and each
 * district's name over its centre.
 */
export function blockWorld( atlas, networks, { streetOf = () => null } = {} ) {

	const streets = new Map();
	for ( const edge of atlas.streets?.edges ?? [] ) {

		const street = streetOf( edge.id );
		if ( ! street || ( street.kind !== 'street' && street.kind !== 'avenue' ) || edge.path.length < 2 ) continue;
		if ( ! streets.has( street.id ) ) streets.set( street.id, { name: street.name, paths: [] } );
		streets.get( street.id ).paths.push( edge.path.map( ( [ x, z ] ) => [ x, z ] ) );

	}
	return {
		bounds: atlas.meta.bounds,
		buildings: atlas.volumetric.buildings.map( ( building ) => ( { ring: building.footprint, height: building.height } ) ),
		ground: atlas.volumetric.ground,
		transit: transitModel( atlas, networks, ( point ) => [ ...point ] ),
		streets: [ ...streets.values() ],
		districts: ( atlas.districts ?? [] ).flatMap( ( district ) => {

			const center = district.center ?? centreOf( district.boundary ?? [] );
			return center ? [ { name: districtLabel( district ), center: [ center[ 0 ], center[ 1 ] ] } ] : [];

		} )
	};

}

/** The middle of a ring's extent, or null for none. */
function centreOf( ring ) {

	if ( ! ring.length ) return null;
	const xs = ring.map( ( [ x ] ) => x ), zs = ring.map( ( [ , z ] ) => z );
	return [ ( Math.min( ...xs ) + Math.max( ...xs ) ) / 2, ( Math.min( ...zs ) + Math.max( ...zs ) ) / 2 ];

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
