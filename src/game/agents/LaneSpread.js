/** Room one walker keeps along the pavement from the next one at spawn. */
export const LANE_SPACING = 1.2;

/**
 * Where the people the simulation reports actually stand. A crowd slice is
 * counts and candidates: a group is reported on one walk edge at one progress,
 * which placed as reported is five bodies on one spot walking in step. They
 * belong on that pavement, at arm's length along it, and when the segment
 * cannot hold the whole group the rest carry on to the next segment.
 *
 * @param entries the sampled agents, each with its edge, direction, distance
 * and the spot it was reported at; adjusted in place and returned in order
 * @param routes the walk graph
 */
export function spreadOnLanes( entries, routes ) {

	const lanes = new Map();

	for ( const entry of entries ) group( lanes, entry.edge, entry );

	for ( const [ , here ] of [ ...lanes ] ) {

		const overflow = here.group.splice( capacity( here.edge ) );

		for ( const entry of overflow ) carryOn( entry, routes, lanes );

	}

	for ( const here of lanes.values() ) space( here, routes );

	return entries;

}

/** People one segment holds at arm's length, never fewer than one. */
function capacity( edge ) {

	return Math.max( 1, Math.floor( edge.length / LANE_SPACING ) + 1 );

}

function group( lanes, edge, entry ) {

	const here = lanes.get( edge.id );

	if ( here ) here.group.push( entry );
	else lanes.set( edge.id, { edge, group: [ entry ] } );

}

/**
 * One walker the segment cannot hold walks on to the next segment of their
 * own route, at the end they were heading for. When every way out is as full
 * as this one they stay, and the whole group closes up instead.
 */
function carryOn( entry, routes, lanes ) {

	const node = routes.exitNode( entry.edge, entry.direction );

	for ( const next of routes.neighbours( entry.edge ) ) {

		if ( next.from !== node && next.to !== node ) continue;

		const here = lanes.get( next.id );

		if ( here && here.group.length >= capacity( next ) ) continue;

		entry.direction = next.from === node ? 1 : - 1;
		entry.edge = next;
		entry.distance = 0;
		group( lanes, next, entry );

		return;

	}

	group( lanes, entry.edge, entry );

}

/**
 * One segment's group, spread along it in the order it was reported in, each
 * of them as near the spot the simulation gave them as the spacing allows.
 * Distance runs with each walker's own direction, so the order is taken in
 * the segment's own frame and handed back in theirs.
 */
function space( { edge, group: here }, routes ) {

	const order = here
		.map( ( entry ) => ( { entry, along: from( entry, edge ) } ) )
		.sort( ( left, right ) => left.along - right.along ||
			left.entry.agent.crowdId.localeCompare( right.entry.agent.crowdId ) );
	const spacing = Math.min( LANE_SPACING, edge.length / Math.max( 1, order.length - 1 ) );
	const last = order.length - 1;

	for ( let index = 1; index <= last; index ++ ) {

		order[ index ].along = Math.max( order[ index ].along, order[ index - 1 ].along + spacing );

	}

	order[ last ].along = Math.min( order[ last ].along, edge.length );

	for ( let index = last - 1; index >= 0; index -- ) {

		order[ index ].along = Math.min( order[ index ].along, order[ index + 1 ].along - spacing );

	}

	order.forEach( ( { entry, along }, index ) => {

		const bounded = Math.max( 0, Math.min( edge.length, along ) );
		entry.distance = entry.direction === 1 ? bounded : edge.length - bounded;
		entry.slot = index;
		entry.at = routes.pointAt( edge, entry.distance, entry.direction );

	} );

}

/** A walker's travel distance as a distance from the segment's own start. */
function from( entry, edge ) {

	return entry.direction === 1 ? entry.distance : edge.length - entry.distance;

}
