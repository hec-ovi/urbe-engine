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

		this.networks = networks;
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

	/** Nearest exact point on an authoritative edge, with authored progress. */
	project( point ) {

		let best = null;

		for ( const edge of this.walkable ) {

			let before = 0;

			for ( let index = 1; index < edge.path.length; index ++ ) {

				const a = edge.path[ index - 1 ];
				const b = edge.path[ index ];
				const span = distance( a, b );
				const t = span > 0 ? clamp01( dot( point, a, b ) / ( span * span ) ) : 0;
				const at = [
					a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * t,
					a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t,
					a[ 2 ] + ( b[ 2 ] - a[ 2 ] ) * t
				];
				const gap = distance( point, at );
				const along = before + span * t;
				if ( ! best || gap < best.gap - 1e-9 || ( Math.abs( gap - best.gap ) <= 1e-9 && edge.id < best.edge.id ) ) {

					best = { edge, point: at, gap, distance: along, progress: along / edge.length };

				}
				before += span;

			}

		}

		return best;

	}

	/**
	 * Shortest path between two positions. The graph portion and both projected
	 * edge portions are cut only from Connections path3. A final short lead is
	 * included when either requested point sits off the walking surface.
	 */
	route( from, to ) {

		const start = this.project( from );
		const finish = this.project( to );
		if ( ! start || ! finish ) return null;
		const candidates = [];

		if ( start.edge.id === finish.edge.id ) {

			const forward = start.distance <= finish.distance;
			candidates.push( {
				distance: Math.abs( finish.distance - start.distance ),
				edgeIds: [ start.edge.id ],
				path3: slice( start.edge, start.distance, finish.distance, forward ? 1 : - 1 )
			} );

		}

		for ( const first of endpoints( start ) ) for ( const last of endpoints( finish ) ) {

			const middle = this.#shortest( first.nodeId, last.nodeId );
			if ( ! middle ) continue;
			const path3 = [];
			append( path3, first.path3 );
			for ( const leg of middle.legs ) append( path3, leg.direction === 1 ? leg.edge.path : [ ...leg.edge.path ].reverse() );
			append( path3, [ ...last.path3 ].reverse() );
			candidates.push( {
				distance: first.distance + middle.distance + last.distance,
				edgeIds: [ start.edge.id, ...middle.legs.map( ( leg ) => leg.edge.id ), finish.edge.id ],
				path3
			} );

		}

		if ( ! candidates.length ) return null;
		candidates.sort( ( a, b ) => a.distance - b.distance || a.edgeIds.join( '\0' ).localeCompare( b.edgeIds.join( '\0' ) ) );
		const best = candidates[ 0 ];
		const path3 = [];
		append( path3, [ [ ...from ], start.point ] );
		append( path3, best.path3 );
		append( path3, [ finish.point, [ ...to ] ] );

		return {
			path3,
			edgeIds: best.edgeIds.filter( ( id, index, ids ) => index === 0 || id !== ids[ index - 1 ] ),
			distanceMeters: pathLength( path3 )
		};

	}

	#shortest( startId, finishId ) {

		if ( startId === finishId ) return { distance: 0, legs: [] };
		const distances = new Map( [ [ startId, 0 ] ] );
		const previous = new Map();
		const open = new Set( [ startId ] );
		const settled = new Set();

		while ( open.size ) {

			const current = [ ...open ].sort( ( a, b ) => distances.get( a ) - distances.get( b ) || a.localeCompare( b ) )[ 0 ];
			open.delete( current );
			if ( current === finishId ) break;
			if ( settled.has( current ) ) continue;
			settled.add( current );
			for ( const edgeId of this.adjacency.get( current ) ?? [] ) {

				const edge = this.edges.get( edgeId );
				const to = edge.from === current ? edge.to : edge.from;
				if ( settled.has( to ) ) continue;
				const leg = { edge, to, direction: edge.from === current ? 1 : - 1 };
				const candidate = distances.get( current ) + edge.length;
				const known = distances.get( to ) ?? Infinity;
				const old = previous.get( to );
				if ( candidate > known + 1e-9 ) continue;
				if ( Math.abs( candidate - known ) <= 1e-9 && old && compareLeg( leg, old ) >= 0 ) continue;
				distances.set( to, candidate );
				previous.set( to, { ...leg, from: current } );
				open.add( to );

			}

		}

		if ( ! distances.has( finishId ) ) return null;
		const legs = [];
		let cursor = finishId;
		while ( cursor !== startId ) {

			const leg = previous.get( cursor );
			if ( ! leg ) return null;
			legs.push( leg );
			cursor = leg.from;

		}
		return { distance: distances.get( finishId ), legs: legs.reverse() };

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

function endpoints( projection ) {

	return [
		{
			nodeId: projection.edge.from,
			distance: projection.distance,
			path3: slice( projection.edge, projection.distance, 0, - 1 )
		},
		{
			nodeId: projection.edge.to,
			distance: projection.edge.length - projection.distance,
			path3: slice( projection.edge, projection.distance, projection.edge.length, 1 )
		}
	];

}

/** Portion of a measured edge in requested travel order. */
function slice( edge, fromDistance, toDistance, direction ) {

	const low = Math.min( fromDistance, toDistance );
	const high = Math.max( fromDistance, toDistance );
	const points = [ vector( sample( edge, low, 1 ) ) ];
	for ( let index = 1; index < edge.cumulative.length - 1; index ++ ) {

		if ( edge.cumulative[ index ] > low && edge.cumulative[ index ] < high ) points.push( [ ...edge.path[ index ] ] );

	}
	points.push( vector( sample( edge, high, 1 ) ) );
	return direction === 1 ? points : points.reverse();

}

function vector( point ) {

	return [ point.x, point.y, point.z ];

}

function append( target, source ) {

	for ( const point of source ) {

		if ( ! target.length || distance( target.at( - 1 ), point ) > 1e-9 ) target.push( [ ...point ] );

	}

}

function pathLength( path ) {

	let total = 0;
	for ( let index = 1; index < path.length; index ++ ) total += distance( path[ index - 1 ], path[ index ] );
	return total;

}

function distance( a, b ) {

	return Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ], b[ 2 ] - a[ 2 ] );

}

function dot( point, a, b ) {

	return ( point[ 0 ] - a[ 0 ] ) * ( b[ 0 ] - a[ 0 ] ) +
		( point[ 1 ] - a[ 1 ] ) * ( b[ 1 ] - a[ 1 ] ) +
		( point[ 2 ] - a[ 2 ] ) * ( b[ 2 ] - a[ 2 ] );

}

function clamp01( value ) {

	return Math.max( 0, Math.min( 1, value ) );

}

function compareLeg( left, right ) {

	return left.edge.id.localeCompare( right.edge.id ) || left.to.localeCompare( right.to );

}
