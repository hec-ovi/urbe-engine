/**
 * What a kit building is, to the player's body.
 *
 * Rapier documents the cuboid as the building and room shape: it has an
 * inside, it needs no cooking, and a compound of them is one broad-phase entry
 * however many parts it holds. So a kit building is its footprint walls by
 * envelope height, pierced wherever its blueprint is open so a doorway is a
 * real hole rather than a trimesh with a gap in it, a cap over the roof so
 * anything walking a rooftop span stays on it, cut where a stair head comes
 * through, a low band wherever the plan's own plinths, steps and planter walls
 * stand proud of that footprint, and the entrance leaf itself when nothing else
 * is going to move it.
 *
 * The walls follow the building and not its lot, because the lot line stands
 * one to eight metres in front of the facade and the paving between them is
 * where the player walks.
 *
 * None of these cost a triangle.
 */

/** How thick a perimeter wall stands, inward from the footprint edge. */
const WALL = 0.5;
/** And how thick the roof reads from above. */
const CAP = 0.4;
/** A closed building's entrance leaf fills its own opening. */
const LEAF = 0.12;

/**
 * @param placement KitPlacement
 * @param openings every hole this building's blueprint reserves, from KitOpenings
 * @param leaf the entrance door frame when nothing is going to move it, else null
 * @returns [{ center: [x,y,z], halfExtents: [hx,hy,hz], rotationY }]
 */
export function buildingBoxes( placement, { openings = null, leaf = null } = {} ) {

	const boxes = [];
	const { height, base } = placement;
	const top = base + height;
	const holes = [ [], [], [], [] ];

	for ( const cut of openings?.walls ?? [] ) holes[ cut.face ]?.push( cut );

	for ( let face = 0; face < 4; face ++ ) {

		boxes.push( ...pierced( placement, placement.edge( face ), base, top, holes[ face ] ) );

	}

	boxes.push( ...bands( placement, base, holes ) );
	boxes.push( ...cap( placement, top, openings?.roof ?? [] ) );

	if ( leaf ) {

		boxes.push( {
			center: [ leaf.center.x, leaf.center.y + leaf.height / 2, leaf.center.z ],
			halfExtents: [ leaf.width / 2, leaf.height / 2, LEAF / 2 ],
			rotationY: Math.atan2( - leaf.along.z, leaf.along.x )
		} );

	}

	return boxes.filter( ( box ) => box.halfExtents.every( ( half ) => half > 1e-4 ) );

}

/** One edge, standing everywhere its openings leave it standing. */
function pierced( placement, edge, base, top, holes, thickness = WALL ) {

	const boxes = [];
	const slab = ( from, to, bottom, ceiling ) => wall( placement, edge, from, to, bottom, ceiling, thickness );
	let cursor = 0;

	for ( const span of merged( holes, edge.length, base, top ) ) {

		if ( span.from > cursor ) boxes.push( slab( cursor, span.from, base, top ) );
		if ( span.bottom > base ) boxes.push( slab( span.from, span.to, base, span.bottom ) );
		if ( span.top < top ) boxes.push( slab( span.from, span.to, span.top, top ) );
		cursor = span.to;

	}
	if ( cursor < edge.length ) boxes.push( slab( cursor, edge.length, base, top ) );

	return boxes;

}

/**
 * The ground band: what the plan stands on rather than what it is. A few
 * families carry a plinth, entrance steps or a planter wall outside their own
 * footprint, all of it below head height, and without a collider the player
 * walks straight through them. Each stretch of a face that carries one gets a
 * low slab from the footprint line out to what the geometry reaches, cut by the
 * same openings, so the entrance stays open through it.
 */
function bands( placement, base, holes ) {

	const boxes = [];

	for ( let face = 0; face < 4; face ++ ) {

		const edge = placement.edge( face );

		for ( const run of placement.bands?.[ face ] ?? [] ) {

			// Paving flush with the ground is nothing to walk into.
			if ( ! ( run.height > 0 ) ) continue;

			boxes.push( ...pierced(
				placement, outside( edge, run ), base, base + run.height,
				holes[ face ].map( ( hole ) => ( { ...hole, from: hole.from - run.from, to: hole.to - run.from } ) ),
				run.depth
			) );

		}

	}

	return boxes;

}

/** The stretch of a face a band stands along, moved out to the band's far side. */
function outside( edge, run ) {

	return {
		...edge,
		length: run.to - run.from,
		start: [
			edge.start[ 0 ] + edge.direction[ 0 ] * run.from - edge.inward[ 0 ] * run.depth,
			edge.start[ 1 ] + edge.direction[ 1 ] * run.from - edge.inward[ 1 ] * run.depth
		]
	};

}

/**
 * Openings that meet along one edge become one hole tall enough for both, so
 * stacked reservations never leave a sliver of wall standing between them. An
 * opening that misses this slab's own heights is not its hole: a balcony door
 * on the tenth floor leaves the ground band whole.
 */
function merged( holes, length, base, top ) {

	const spans = holes
		.filter( ( hole ) => hole.top > base + 1e-4 && hole.bottom < top - 1e-4 )
		.map( ( hole ) => ( {
			from: Math.max( 0, Math.min( hole.from, hole.to ) ),
			to: Math.min( length, Math.max( hole.from, hole.to ) ),
			bottom: hole.bottom, top: hole.top
		} ) )
		.filter( ( span ) => span.to - span.from > 1e-4 )
		.sort( ( a, b ) => a.from - b.from );

	const kept = [];

	for ( const span of spans ) {

		const last = kept[ kept.length - 1 ];
		if ( last && span.from <= last.to + 1e-4 ) {

			last.to = Math.max( last.to, span.to );
			last.bottom = Math.min( last.bottom, span.bottom );
			last.top = Math.max( last.top, span.top );

		} else kept.push( { ...span } );

	}

	return kept;

}

/** The roof plate, as the rectangles its stair heads leave of it. */
function cap( placement, top, holes ) {

	let plates = [ { ...placement.footprint } ];

	for ( const hole of holes ) plates = plates.flatMap( ( plate ) => without( plate, hole ) );

	return plates.map( ( plate ) => ( {
		center: placement.point( ( plate.u0 + plate.u1 ) / 2, top - CAP / 2, ( plate.v0 + plate.v1 ) / 2 ).toArray(),
		halfExtents: [ ( plate.u1 - plate.u0 ) / 2, CAP / 2, ( plate.v1 - plate.v0 ) / 2 ],
		rotationY: placement.rotationY
	} ) );

}

/** One rectangle minus another, as the rectangles left around it. */
function without( plate, hole ) {

	const u0 = Math.max( plate.u0, hole.u0 );
	const u1 = Math.min( plate.u1, hole.u1 );
	const v0 = Math.max( plate.v0, hole.v0 );
	const v1 = Math.min( plate.v1, hole.v1 );

	if ( u1 - u0 <= 1e-4 || v1 - v0 <= 1e-4 ) return [ plate ];

	return [
		{ ...plate, v1: v0 },
		{ ...plate, v0: v1 },
		{ u0: plate.u0, u1: u0, v0, v1 },
		{ u0: u1, u1: plate.u1, v0, v1 }
	].filter( ( rest ) => rest.u1 - rest.u0 > 1e-4 && rest.v1 - rest.v0 > 1e-4 );

}

/** One upright slab standing along an edge, between two heights. */
function wall( placement, edge, from, to, bottom, top, thickness ) {

	const middle = ( from + to ) / 2;
	const centre = placement.point(
		edge.start[ 0 ] + edge.direction[ 0 ] * middle + edge.inward[ 0 ] * ( thickness / 2 ),
		( bottom + top ) / 2,
		edge.start[ 1 ] + edge.direction[ 1 ] * middle + edge.inward[ 1 ] * ( thickness / 2 )
	);

	return {
		center: centre.toArray(),
		halfExtents: [ ( to - from ) / 2, ( top - bottom ) / 2, thickness / 2 ],
		rotationY: edge.rotationY
	};

}
