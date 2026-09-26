/**
 * Which way a kit building faces its lot.
 *
 * A plan is drawn with face 0, its entrance, along +X, so a parcel's frame and
 * the bays its plan is named after both follow from the lot face that fronts
 * the street. Families fit a plate as it is turned, so the family choice reads
 * the lot the same way.
 */

/** edge id -> street centreline, the run a lot's entrance face fronts. */
export function streetPaths( atlas ) {

	return new Map( atlas.streets.edges.map( ( edge ) => [ edge.id, edge.path ] ) );

}

/**
 * Which lot face fronts the street: the face whose middle stands nearest the
 * access edge's centreline. The access point alone cannot say: Atlas puts it
 * on a corner of a corner lot, equally near the front and the side, and a
 * door decided by that tie opens into the alley.
 * @param footprint the lot ring, wound the way lotRectangle returns it
 * @param access the Atlas parcel's `{ edgeId, point }`
 * @param streets streetPaths of the same blueprint
 */
export function entranceFace( footprint, access, streets ) {

	const street = streets.get( access.edgeId ) ?? [ access.point ];
	let nearest = 0;
	let best = Infinity;

	for ( let face = 0; face < 4; face ++ ) {

		const from = footprint[ face ];
		const to = footprint[ ( face + 1 ) % 4 ];
		const distance = toPolyline( [ ( from[ 0 ] + to[ 0 ] ) / 2, ( from[ 1 ] + to[ 1 ] ) / 2 ], street );

		if ( distance < best ) {

			best = distance;
			nearest = face;

		}

	}

	return nearest;

}

/**
 * A lot's bays as the building standing on it sees them: across the entrance
 * face and deep from it.
 * @param bays `{ across, deep }` along the lot ring's faces 0 and 1
 */
export function facing( bays, face ) {

	return face % 2 === 0 ? bays : { across: bays.deep, deep: bays.across };

}

/** How far a point stands from a street's centreline; a single point is a run of no length. */
function toPolyline( point, path ) {

	let best = Infinity;

	for ( let index = 0; index < Math.max( 1, path.length - 1 ); index ++ ) {

		best = Math.min( best, toSegment( point, path[ index ], path[ Math.min( index + 1, path.length - 1 ) ] ) );

	}

	return best;

}

/** How far a point stands from one segment. */
function toSegment( point, from, to ) {

	const dx = to[ 0 ] - from[ 0 ];
	const dz = to[ 1 ] - from[ 1 ];
	const length = dx * dx + dz * dz;
	const along = length > 0
		? Math.max( 0, Math.min( 1, ( ( point[ 0 ] - from[ 0 ] ) * dx + ( point[ 1 ] - from[ 1 ] ) * dz ) / length ) )
		: 0;

	return Math.hypot( point[ 0 ] - ( from[ 0 ] + dx * along ), point[ 1 ] - ( from[ 1 ] + dz * along ) );

}
