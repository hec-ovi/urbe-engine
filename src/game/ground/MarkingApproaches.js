import { fail, side, lerp3 } from './MarkingPath.js';

/** Field polygons are the trimming authority, not projected lane stations. */
export class MarkingApproaches {

	constructor( atlas ) {

		this.byEdge = new Map();
		this.internal = new Set();
		const edges = new Map( ( atlas.streets?.edges ?? [] ).map( edge => [ edge.id, edge ] ) );
		for ( const junction of atlas.streets?.construction?.junctions ?? [] ) {

			if ( ! Array.isArray( junction?.internalEdgeIds ) || ! Array.isArray( junction.approaches ) ) fail( 'Invalid marking junction' );
			for ( const edgeId of junction.internalEdgeIds ) this.internal.add( edgeId );
			for ( const approach of junction.approaches ) {

				const edge = edges.get( approach.edgeId );
				if ( ! edge || ! [ edge.from, edge.to ].includes( approach.nodeId ) || approach.field?.length !== 4
					|| approach.field.some( point => ! point2( point ) ) || ! point2( approach.cut?.left ) || ! point2( approach.cut?.right )
					|| ! Number.isFinite( approach.distance ) ) fail( 'Invalid marking approach ownership' );
				const dx = approach.cut.right[ 0 ] - approach.cut.left[ 0 ];
				const dz = approach.cut.right[ 1 ] - approach.cut.left[ 1 ];
				const length = Math.hypot( dx, dz );
				if ( length < 1e-8 ) fail( 'Invalid marking approach cut' );
				const sign = approach.nodeId === edge.from ? 1 : - 1;
				const normal = [ - dz * sign / length, dx * sign / length ];
				const distance = Math.max( ...approach.field.map( point => point[ 0 ] * normal[ 0 ] + point[ 1 ] * normal[ 1 ] ) );
				if ( ! this.byEdge.has( edge.id ) ) this.byEdge.set( edge.id, [] );
				const entries = this.byEdge.get( edge.id );
				if ( entries.some( entry => entry.nodeId === approach.nodeId ) ) fail( 'Duplicate marking approach' );
				entries.push( { nodeId: approach.nodeId, normal, distance, source: approach } );

			}

		}

	}

	planes( edgeId ) { return this.byEdge.get( edgeId ) ?? []; }

}

const point2 = point => Array.isArray( point ) && point.length === 2 && point.every( Number.isFinite );

/** A solid line terminates on a common field plane, with its complete width. */
export function clipPlanes( polygon, planes, margin = 0 ) {

	let points = polygon;
	for ( const plane of planes ) {

		const result = [];
		for ( let i = 0; i < points.length; i ++ ) {

			const a = points[ i ];
			const b = points[ ( i + 1 ) % points.length ];
			const da = side( a, plane ) - margin;
			const db = side( b, plane ) - margin;
			if ( da >= 0 ) result.push( a );
			if ( ( da >= 0 ) !== ( db >= 0 ) ) result.push( lerp3( a, b, da / ( da - db ) ) );

		}
		points = result;

	}
	return points.length >= 3 ? points : [];

}
