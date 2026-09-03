import { ObjectiveRouteBoundary } from './ObjectiveRouteBoundary.js';
import { ObjectiveRouteError } from './ObjectiveRouteError.js';

const DESTINATION_NODE_KIND = { parcel: 'entry', station: 'station', stop: 'stop' };
const EPSILON = 1e-9;

/** Shortest quest route over Connections' authoritative three-dimensional walk graph. */
export class ObjectiveRouter {

	constructor( network, boundary = new ObjectiveRouteBoundary() ) {

		this.boundary = boundary;
		this.network = this.boundary.input( 'walk-network', network );
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

	}

	/** Recomputes from the current feet, so callers can reroute after every meaningful deviation. */
	route( request ) {

		this.boundary.input( 'route-request', request );
		const start = nearestNode( [ ...this.nodes.values() ], request.from );
		const destination = destinationNode( this.nodes, request.destination );

		if ( ! destination ) {

			throw new ObjectiveRouteError(
				'E_OBJECTIVE_ROUTE_DESTINATION',
				`walk network has no ${request.destination.kind} destination ${request.destination.id}`
			);

		}

		const route = this.#shortest( start.id, destination.id );
		if ( ! route ) {

			throw new ObjectiveRouteError(
				'E_OBJECTIVE_ROUTE_UNREACHABLE',
				`${request.destination.kind} ${request.destination.id} is unreachable from ${start.id}`
			);

		}

		const lead = [ request.from, pointOf( start ) ];
		const path3 = appendPath( [], lead );
		for ( const leg of route.legs ) appendPath( path3, leg.direction === 1 ? leg.edge.path3 : [ ...leg.edge.path3 ].reverse() );

		return this.boundary.output( 'route-result', {
			destination: request.destination,
			nodeIds: [ start.id, ...route.legs.map( ( leg ) => leg.to ) ],
			edgeIds: route.legs.map( ( leg ) => leg.edge.id ),
			path3,
			distanceMeters: pathLength( lead ) + route.distance
		} );

	}

	#shortest( startId, destinationId ) {

		const distance = new Map( [ [ startId, 0 ] ] );
		const previous = new Map();
		const open = new Set( [ startId ] );

		while ( open.size ) {

			const current = [ ...open ].sort( ( a, b ) => ( distance.get( a ) - distance.get( b ) ) || a.localeCompare( b ) )[ 0 ];
			open.delete( current );
			if ( current === destinationId ) break;

			for ( const leg of this.adjacency.get( current ) ) {

				const candidate = distance.get( current ) + leg.edge.distance;
				const known = distance.get( leg.to ) ?? Infinity;
				const knownPrevious = previous.get( leg.to );
				if ( candidate > known + EPSILON ) continue;
				if ( Math.abs( candidate - known ) <= EPSILON && knownPrevious && compareLinks( leg, knownPrevious ) >= 0 ) continue;
				distance.set( leg.to, candidate );
				previous.set( leg.to, { ...leg, from: current } );
				open.add( leg.to );

			}

		}

		if ( ! distance.has( destinationId ) ) return null;
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

function destinationNode( nodes, destination ) {

	const kind = DESTINATION_NODE_KIND[ destination.kind ];
	return [ ...nodes.values() ]
		.filter( ( node ) => node.kind === kind && node.ref === destination.id )
		.sort( ( a, b ) => a.id.localeCompare( b.id ) )[ 0 ] ?? null;

}

function nearestNode( nodes, point ) {

	if ( nodes.length === 0 ) throw new ObjectiveRouteError( 'E_OBJECTIVE_ROUTE_NETWORK', 'walk network has no nodes' );
	return nodes.reduce( ( best, node ) => {

		const distance = pointDistance( point, pointOf( node ) );
		const bestDistance = pointDistance( point, pointOf( best ) );
		return distance < bestDistance - EPSILON || ( Math.abs( distance - bestDistance ) <= EPSILON && node.id < best.id ) ? node : best;

	} );

}

function compareLinks( left, right ) {

	return left.edge.id.localeCompare( right.edge.id ) || left.to.localeCompare( right.to );

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
