/**
 * The atlas blueprint reduced to what a top-down map needs: city bounds, the
 * street centrelines with their widths, and the block outlines. Plain [x, z]
 * arrays, so the UI can draw it without knowing anything about the atlas.
 */
export function mapModel( atlas ) {

	return {
		bounds: atlas.meta.bounds,
		roads: atlas.streets.edges.map( ( edge ) => ( { path: edge.path, width: edge.width } ) ),
		blocks: atlas.volumetric.ground
			.filter( ( cover ) => cover.surface === 'block' )
			.map( ( cover ) => cover.polygon )
	};

}

/** Every rail station on the map, named by its network until the naming pass gives it a name. */
export function stations( atlas ) {

	const of = ( list, kind ) => ( list ?? [] ).map( ( station ) => ( { point: station.position, name: `${kind} ${station.id}` } ) );

	return [ ...of( atlas.transit?.trainStations, 'train' ), ...of( atlas.transit?.subwayStations, 'subway' ) ];

}
