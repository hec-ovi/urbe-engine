import { measure, sample } from './Polyline.js';

/**
 * The sidewalk network as something to walk on: every walk edge measured and
 * indexed by its end nodes, so an agent can be placed at a distance along an
 * edge, advanced, and handed a next edge when it runs out. Crossings keep
 * their signal reference, which is what stops the crowd from stepping into
 * traffic on a red.
 */
export class WalkRoutes {

	constructor( networks ) {

		this.edges = new Map();
		this.nodes = new Map();
		this.adjacency = new Map();

		for ( const node of networks.walk.nodes ) {

			this.nodes.set( node.id, node );
			this.adjacency.set( node.id, [] );

		}

		for ( const edge of networks.walk.edges ) {

			const measured = measureEdge( edge );

			if ( measured.length < 0.5 ) continue;

			this.edges.set( edge.id, measured );
			this.adjacency.get( edge.from )?.push( edge.id );
			this.adjacency.get( edge.to )?.push( edge.id );

		}

		this.walkable = [ ...this.edges.values() ];

	}

	/** Edges whose midpoint sits inside a ring around the player. */
	near( position, inner, outer ) {

		const found = [];

		for ( const edge of this.walkable ) {

			const distance = Math.hypot( edge.mid[ 0 ] - position.x, edge.mid[ 2 ] - position.z );

			if ( distance >= inner && distance <= outer ) found.push( edge );

		}

		return found;

	}

	/**
	 * Where an agent stands and which way it faces.
	 * @param direction 1 walks from->to, -1 walks to->from
	 */
	pointAt( edge, distance, direction ) {

		return sample( edge, distance, direction );

	}

	/** The node an agent reaches at the end of an edge in its direction. */
	exitNode( edge, direction ) {

		return direction === 1 ? edge.to : edge.from;

	}

	/** A different edge out of `nodeId`, or the same one reversed at a dead end. */
	nextFrom( nodeId, currentId, rng ) {

		const options = ( this.adjacency.get( nodeId ) ?? [] ).filter( ( id ) => id !== currentId );
		const pick = options.length ? options[ Math.floor( rng() * options.length ) ] : currentId;
		const edge = this.edges.get( pick );

		if ( ! edge ) return null;

		return { edge, direction: edge.from === nodeId ? 1 : - 1 };

	}

}

function measureEdge( edge ) {

	return {
		id: edge.id,
		from: edge.from,
		to: edge.to,
		kind: edge.kind,
		signal: edge.signal ?? null,
		...measure( edge.path3, `walk edge ${edge.id}.path3` )
	};

}
