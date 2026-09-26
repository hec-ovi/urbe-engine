import { measure, sample } from './Polyline.js';

/** Side of one square cell of the segment index used by `project`, in metres. */
const CELL = 16;
const TIE = 1e-9;

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
		this.grid = segmentGrid( this.walkable );
		this.stamp = 0;

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

	/** The segments of pavement that carry on from this one, at either end. */
	neighbours( edge ) {

		const found = [];

		for ( const nodeId of [ edge.from, edge.to ] ) {

			for ( const id of this.adjacency.get( nodeId ) ?? [] ) {

				const next = this.edges.get( id );

				if ( id !== edge.id && next && ! found.includes( next ) ) found.push( next );

			}

		}

		return found;

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

	/**
	 * Nearest exact point on an authoritative edge, with authored progress.
	 * Cells are searched in rings around the point until no unvisited segment
	 * can be nearer; ties go to the lower edge id, then its earlier segment.
	 */
	project( point ) {

		const grid = this.grid;
		if ( ! grid ) return null;
		const cx = clampCell( ( point[ 0 ] - grid.x0 ) / CELL, grid.cols );
		const cz = clampCell( ( point[ 2 ] - grid.z0 ) / CELL, grid.rows );
		const stamp = ++ this.stamp;
		let best = null;
		for ( let ring = 0; ; ring ++ ) {

			for ( const cell of ringCells( grid, cx, cz, ring ) ) for ( const segment of grid.cells.get( cell ) ?? [] ) {

				if ( segment.stamp === stamp ) continue;
				segment.stamp = stamp;
				const { a, b, span } = segment;
				const t = span > 0 ? clamp01( dot( point, a, b ) / ( span * span ) ) : 0;
				const at = [
					a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * t,
					a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t,
					a[ 2 ] + ( b[ 2 ] - a[ 2 ] ) * t
				];
				const gap = distance( point, at );
				if ( best && ! nearer( gap, segment, best ) ) continue;
				const along = segment.before + span * t;
				best = { edge: segment.edge, index: segment.index, point: at, gap, distance: along, progress: along / segment.edge.length };

			}
			const reach = unvisitedReach( grid, point, cx, cz, ring );
			if ( reach === Infinity || ( best && best.gap + TIE < reach ) ) break;

		}
		if ( ! best ) return null;
		const { index, ...projection } = best;
		return projection;

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

	/** Dijkstra over the walk graph, settling nodes in (distance, node id) order. */
	#shortest( startId, finishId ) {

		if ( startId === finishId ) return { distance: 0, legs: [] };
		const distances = new Map( [ [ startId, 0 ] ] );
		const previous = new Map();
		const open = new MinHeap( ( a, b ) => a.distance - b.distance || a.nodeId.localeCompare( b.nodeId ) );
		open.push( { distance: 0, nodeId: startId } );
		const settled = new Set();

		while ( open.size ) {

			const { distance: reached, nodeId: current } = open.pop();
			if ( reached !== distances.get( current ) ) continue;
			if ( current === finishId ) break;
			if ( settled.has( current ) ) continue;
			settled.add( current );
			for ( const edgeId of this.adjacency.get( current ) ?? [] ) {

				const edge = this.edges.get( edgeId );
				const to = edge.from === current ? edge.to : edge.from;
				if ( settled.has( to ) ) continue;
				const leg = { edge, to, direction: edge.from === current ? 1 : - 1 };
				const candidate = reached + edge.length;
				const known = distances.get( to ) ?? Infinity;
				const old = previous.get( to );
				if ( candidate > known + TIE ) continue;
				if ( Math.abs( candidate - known ) <= TIE && old && compareLeg( leg, old ) >= 0 ) continue;
				distances.set( to, candidate );
				previous.set( to, { ...leg, from: current } );
				open.push( { distance: candidate, nodeId: to } );

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

/** Binary min-heap ordered by `compare`. */
class MinHeap {

	constructor( compare ) {

		this.compare = compare;
		this.items = [];

	}

	get size() { return this.items.length; }

	push( item ) {

		const items = this.items;
		items.push( item );
		let index = items.length - 1;
		while ( index > 0 ) {

			const parent = ( index - 1 ) >> 1;
			if ( this.compare( items[ parent ], item ) <= 0 ) break;
			items[ index ] = items[ parent ];
			index = parent;

		}
		items[ index ] = item;

	}

	pop() {

		const items = this.items;
		const top = items[ 0 ];
		const last = items.pop();
		if ( items.length ) {

			let index = 0;
			for ( ;; ) {

				let child = index * 2 + 1;
				if ( child >= items.length ) break;
				if ( child + 1 < items.length && this.compare( items[ child + 1 ], items[ child ] ) < 0 ) child ++;
				if ( this.compare( items[ child ], last ) >= 0 ) break;
				items[ index ] = items[ child ];
				index = child;

			}
			items[ index ] = last;

		}
		return top;

	}

}

/** Every edge segment filed under each CELL its XZ bounds touch. */
function segmentGrid( edges ) {

	const segments = [];
	for ( const edge of edges ) for ( let index = 1; index < edge.path.length; index ++ ) {

		const a = edge.path[ index - 1 ];
		const b = edge.path[ index ];
		segments.push( { edge, index, a, b, before: edge.cumulative[ index - 1 ], span: distance( a, b ), stamp: 0 } );

	}
	if ( ! segments.length ) return null;
	let x0 = Infinity, z0 = Infinity, x1 = - Infinity, z1 = - Infinity;
	for ( const { a, b } of segments ) {

		x0 = Math.min( x0, a[ 0 ], b[ 0 ] ); x1 = Math.max( x1, a[ 0 ], b[ 0 ] );
		z0 = Math.min( z0, a[ 2 ], b[ 2 ] ); z1 = Math.max( z1, a[ 2 ], b[ 2 ] );

	}
	const grid = { x0, z0, cols: Math.floor( ( x1 - x0 ) / CELL ) + 1, rows: Math.floor( ( z1 - z0 ) / CELL ) + 1, cells: new Map() };
	for ( const segment of segments ) {

		const { a, b } = segment;
		const fromX = clampCell( ( Math.min( a[ 0 ], b[ 0 ] ) - x0 ) / CELL, grid.cols );
		const toX = clampCell( ( Math.max( a[ 0 ], b[ 0 ] ) - x0 ) / CELL, grid.cols );
		const fromZ = clampCell( ( Math.min( a[ 2 ], b[ 2 ] ) - z0 ) / CELL, grid.rows );
		const toZ = clampCell( ( Math.max( a[ 2 ], b[ 2 ] ) - z0 ) / CELL, grid.rows );
		for ( let z = fromZ; z <= toZ; z ++ ) for ( let x = fromX; x <= toX; x ++ ) {

			const key = z * grid.cols + x;
			if ( ! grid.cells.has( key ) ) grid.cells.set( key, [] );
			grid.cells.get( key ).push( segment );

		}

	}
	return grid;

}

/** Keys of the grid cells exactly `ring` cells from (cx, cz). */
function ringCells( grid, cx, cz, ring ) {

	const keys = [];
	for ( let z = Math.max( 0, cz - ring ); z <= Math.min( grid.rows - 1, cz + ring ); z ++ ) {

		const edge = z === cz - ring || z === cz + ring;
		for ( let x = Math.max( 0, cx - ring ); x <= Math.min( grid.cols - 1, cx + ring ); x ++ ) {

			if ( edge || x === cx - ring || x === cx + ring ) keys.push( z * grid.cols + x );

		}

	}
	return keys;

}

/** Least horizontal distance from the point to any cell outside the searched block. */
function unvisitedReach( grid, point, cx, cz, ring ) {

	return Math.min(
		cx - ring <= 0 ? Infinity : point[ 0 ] - ( grid.x0 + ( cx - ring ) * CELL ),
		cx + ring >= grid.cols - 1 ? Infinity : grid.x0 + ( cx + ring + 1 ) * CELL - point[ 0 ],
		cz - ring <= 0 ? Infinity : point[ 2 ] - ( grid.z0 + ( cz - ring ) * CELL ),
		cz + ring >= grid.rows - 1 ? Infinity : grid.z0 + ( cz + ring + 1 ) * CELL - point[ 2 ]
	);

}

function nearer( gap, segment, best ) {

	if ( gap < best.gap - TIE ) return true;
	if ( Math.abs( gap - best.gap ) > TIE ) return false;
	return segment.edge.id < best.edge.id || ( segment.edge === best.edge && segment.index < best.index );

}

function clampCell( value, count ) {

	return Math.max( 0, Math.min( count - 1, Math.floor( value ) ) );

}

function measureEdge( edge ) {

	return {
		id: edge.id,
		from: edge.from,
		to: edge.to,
		kind: edge.kind,
		width: edge.width ?? 0,
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
