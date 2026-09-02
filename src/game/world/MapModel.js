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

/** The city as blocks for the 3D map: every parcel prism and the ground cover, straight off the volumetrics. */
export function blockWorld( atlas ) {

	return {
		bounds: atlas.meta.bounds,
		buildings: atlas.volumetric.buildings.map( ( building ) => ( { ring: building.footprint, height: building.height } ) ),
		ground: atlas.volumetric.ground
	};

}
