/** Catalog dimensions are width, depth, height; placements use Y-up scale. */
export function furnitureBoxes( placements, elevation, props ) {

	const boxes = [];
	for ( const placement of placements ) {

		if ( ! placement.prop || ! props?.has( placement.prop ) ) continue;
		const size = props.entries.get( placement.prop )?.dimensionsMeters;
		if ( ! size ) continue;
		const [ width, depth, height ] = size;
		const [ sx, sy, sz ] = placement.scale;
		boxes.push( {
			center: [ placement.position[ 0 ], elevation + placement.position[ 1 ] + height * sy / 2, placement.position[ 2 ] ],
			halfExtents: [ width * Math.abs( sx ) / 2, height * Math.abs( sy ) / 2, depth * Math.abs( sz ) / 2 ],
			rotationY: placement.rotationY
		} );

	}
	return boxes;

}
