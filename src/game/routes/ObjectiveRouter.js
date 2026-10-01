import { ObjectiveRouteBoundary } from './ObjectiveRouteBoundary.js';
import { ObjectiveRouteError } from './ObjectiveRouteError.js';

const DESTINATION_NODE_KIND = { parcel: 'entry', station: 'station', stop: 'stop' };
const EPSILON = 1e-9;

/**
 * Shortest quest route over Connections' authoritative three-dimensional walk
 * graph, carried on to the parcel's door: the graph ends at the parcel's entry
 * node, which Atlas puts on the sidewalk of its access edge and not always at
 * its frontage, so a route that stopped there could point at an empty pavement.
 */
export class ObjectiveRouter {

	/**
	 * @param places the doors of the city, per parcel; a parcel without one
	 * ends its route at its entry node
	 */
	constructor( network, { places = [], boundary = new ObjectiveRouteBoundary() } = {} ) {

		this.boundary = boundary;
		this.network = this.boundary.input( 'walk-network', network );
		this.doors = new Map( this.boundary.input( 'route-places', places ).map( ( place ) => [ place.parcelId, place.door ] ) );
		this.nodes = new Map( network.nodes.map( ( node ) => [ node.id, node ] ) );
		this.edges = new Map();
		this.adjacency = new Map( network.nodes.map( ( node ) => [ node.id, [] ] ) );

		if ( this.nodes.size !== network.nodes.length ) throw new ObjectiveRouteError( 'E_OBJECTIVE_ROUTE_NETWORK', 'walk network has duplicate nodes' );

		for ( const edge of network.edges ) {

			if ( this.edges.has( edge.id ) ) throw new ObjectiveRouteError( 'E_OBJECTIVE_ROUTE_NETWORK', `duplicate walk edge ${edge.id}` );
			if ( ! this.nodes.has( edge.from ) || ! this.nodes.has( edge.to ) ) {

				throw new ObjectiveRouteError( 'E_OBJECTIVE_ROUTE_NETWORK', `walk edge ${edge.id} references a missing node` );

			}
			const measured = { ...edge, distance: pathLength( edge.path3 ) };
			this.edges.set( edge.id, measured );
			this.adjacency.get( edge.from ).push( { edge: measured, to: edge.to, direction: 1 } );
			this.adjacency.get( edge.to ).push( { edge: measured, to: edge.from, direction: - 1 } );

		}

		for ( const links of this.adjacency.values() ) links.sort( compareLinks );
		this.starts = startNodes( this.nodes, this.adjacency );
		/** The nodes each published destination ends at, by `kind:ref`. */
		this.ends = new Map();
		for ( const node of this.nodes.values() ) {

			const key = `${node.kind}:${node.ref}`;
			if ( ! this.ends.has( key ) ) this.ends.set( key, new Set() );
			this.ends.get( key ).add( node.id );

		}

	}

	/** Recomputes from the current feet, so callers can reroute after every meaningful deviation. */
	route( request ) {

		this.boundary.input( 'route-request', request );
		const start = nearestNode( this.starts, request.from );
		const destinations = this.ends.get( `${DESTINATION_NODE_KIND[ request.destination.kind ]}:${request.destination.id}` ) ?? new Set();

		if ( ! destinations.size ) {

			throw new ObjectiveRouteError(
				'E_OBJECTIVE_ROUTE_DESTINATION',
				`walk network has no ${request.destination.kind} destination ${request.destination.id}`
			);

		}

		const route = this.#shortest( start.id, destinations );
		if ( ! route ) {

			throw new ObjectiveRouteError(
				'E_OBJECTIVE_ROUTE_UNREACHABLE',
				`${request.destination.kind} ${request.destination.id} is unreachable from ${start.id}`
			);

		}

		const lead = [ request.from, pointOf( start ) ];
		const path3 = appendPath( [], lead );
		for ( const leg of route.legs ) appendPath( path3, leg.direction === 1 ? leg.edge.path3 : [ ...leg.edge.path3 ].reverse() );
		const door = request.destination.kind === 'parcel' ? this.doors.get( request.destination.id ) : undefined;
		const doorstep = door ? [ path3.at( - 1 ), door ] : [];
		appendPath( path3, doorstep );

		return this.boundary.output( 'route-result', {
			destination: request.destination,
			nodeIds: [ start.id, ...route.legs.map( ( leg ) => leg.to ) ],
			edgeIds: route.legs.map( ( leg ) => leg.edge.id ),
			path3,
			distanceMeters: pathLength( lead ) + route.distance + pathLength( doorstep )
		} );

	}

	/**
	 * Dijkstra over the walk graph, settling the open node nearest the start
	 * first and, at equal distance, the one whose id sorts first. The open
	 * nodes wait in a binary heap under the distance each was opened at, and an
	 * entry a shorter way has since overtaken is passed over, so every node
	 * settles in the order a full sort of the open set would give, in a
	 * logarithm of the graph instead of the whole open set for every step.
	 */
	#shortest( startId, destinations ) {

		const distance = new Map( [ [ startId, 0 ] ] );
		const previous = new Map();
		const open = new OpenNodes();
		open.push( startId, 0 );
		const settled = new Set();
		let destinationId = null;

		while ( open.size ) {

			const [ current, at ] = open.pop();
			if ( settled.has( current ) || at !== distance.get( current ) ) continue;
			settled.add( current );
			if ( destinations.has( current ) ) { destinationId = current; break; }

			for ( const leg of this.adjacency.get( current ) ) {

				if ( settled.has( leg.to ) ) continue;
				const candidate = distance.get( current ) + leg.edge.distance;
				const known = distance.get( leg.to ) ?? Infinity;
				const knownPrevious = previous.get( leg.to );
				if ( candidate > known + EPSILON ) continue;
				if ( Math.abs( candidate - known ) <= EPSILON && knownPrevious && compareLinks( leg, knownPrevious ) >= 0 ) continue;
				distance.set( leg.to, candidate );
				previous.set( leg.to, { ...leg, from: current } );
				open.push( leg.to, candidate );

			}

		}

		if ( destinationId === null ) return null;
		const legs = [];
		let at = destinationId;
		while ( at !== startId ) {

			const leg = previous.get( at );
			if ( ! leg ) return null;
			legs.push( leg );
			at = leg.from;

		}

		return { distance: distance.get( destinationId ), legs: legs.reverse() };

	}

}

/** Node ids by the distance they were opened at, the nearest first and, at equal distance, the id that sorts first. */
class OpenNodes {

	constructor() {

		this.ids = [];
		this.distances = [];

	}

	get size() {

		return this.ids.length;

	}

	push( id, distance ) {

		const { ids, distances } = this;
		let at = ids.length;
		ids.push( id );
		distances.push( distance );
		while ( at > 0 ) {

			const parent = ( at - 1 ) >> 1;
			if ( ! this.#before( at, parent ) ) break;
			this.#swap( at, parent );
			at = parent;

		}

	}

	/** @returns [ id, distance ] of the first open node */
	pop() {

		const { ids, distances } = this;
		const first = [ ids[ 0 ], distances[ 0 ] ];
		const lastId = ids.pop(), lastDistance = distances.pop();
		if ( ids.length ) {

			ids[ 0 ] = lastId;
			distances[ 0 ] = lastDistance;
			let at = 0;
			for ( ;; ) {

				const left = 2 * at + 1, right = left + 1;
				let best = at;
				if ( left < ids.length && this.#before( left, best ) ) best = left;
				if ( right < ids.length && this.#before( right, best ) ) best = right;
				if ( best === at ) break;
				this.#swap( at, best );
				at = best;

			}

		}
		return first;

	}

	#before( a, b ) {

		const { ids, distances } = this;
		return distances[ a ] < distances[ b ] || ( distances[ a ] === distances[ b ] && ids[ a ].localeCompare( ids[ b ] ) < 0 );

	}

	#swap( a, b ) {

		const { ids, distances } = this;
		const id = ids[ a ], distance = distances[ a ];
		ids[ a ] = ids[ b ];
		distances[ a ] = distances[ b ];
		ids[ b ] = id;
		distances[ b ] = distance;

	}

}

/**
 * The nodes the feet may lead to. A piece of the graph made only of building
 * link portals is a skybridge whose ends stand inside the buildings it joins,
 * which the walk graph does not reach, so no walk starts there.
 */
function startNodes( nodes, adjacency ) {

	const starts = [];
	const seen = new Set();
	for ( const node of nodes.values() ) {

		if ( seen.has( node.id ) ) continue;
		const piece = [ node ];
		seen.add( node.id );
		for ( let index = 0; index < piece.length; index ++ ) for ( const { to } of adjacency.get( piece[ index ].id ) ) {

			if ( seen.has( to ) ) continue;
			seen.add( to );
			piece.push( nodes.get( to ) );

		}
		if ( piece.some( ( member ) => member.kind !== 'link-portal' ) ) starts.push( ...piece );

	}
	return starts;

}

function nearestNode( nodes, point ) {

	if ( nodes.length === 0 ) throw new ObjectiveRouteError( 'E_OBJECTIVE_ROUTE_NETWORK', 'walk network has no nodes' );
	let best = nodes[ 0 ];
	let bestDistance = nodeDistance( point, best );
	for ( let index = 1; index < nodes.length; index ++ ) {

		const node = nodes[ index ];
		const distance = nodeDistance( point, node );
		if ( distance < bestDistance - EPSILON || ( Math.abs( distance - bestDistance ) <= EPSILON && node.id < best.id ) ) {

			best = node;
			bestDistance = distance;

		}

	}
	return best;

}

function compareLinks( left, right ) {

	return left.edge.id.localeCompare( right.edge.id ) || left.to.localeCompare( right.to );

}

function nodeDistance( point, node ) {

	return Math.hypot( point[ 0 ] - node.x, point[ 1 ] - node.y, point[ 2 ] - node.z );

}

function pointOf( node ) {

	return [ node.x, node.y, node.z ];

}

function appendPath( target, source ) {

	for ( const point of source ) {

		const previous = target.at( - 1 );
		if ( ! previous || pointDistance( previous, point ) > EPSILON ) target.push( [ ...point ] );

	}
	return target;

}

function pathLength( path ) {

	let total = 0;
	for ( let index = 1; index < path.length; index ++ ) total += pointDistance( path[ index - 1 ], path[ index ] );
	return total;

}

function pointDistance( left, right ) {

	return Math.hypot( left[ 0 ] - right[ 0 ], left[ 1 ] - right[ 1 ], left[ 2 ] - right[ 2 ] );

}
