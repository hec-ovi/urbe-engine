import defaults from './marking-defaults.json' with { type: 'json' };
import { MarkingApproaches, clipPlanes } from './MarkingApproaches.js';
import { MarkingPath, fail, side } from './MarkingPath.js';
import { arrowPolygons } from './MarkingArrows.js';

/** Lane semantics choose paint; Atlas field boundaries determine its extent. */
export class MarkingPlan {

	constructor( atlas, road, options = {} ) {

		if ( ! Array.isArray( atlas?.streets?.edges ) ) fail( 'Missing marking street graph' );
		if ( ! options || typeof options !== 'object' || Array.isArray( options ) ) fail( 'Invalid marking settings' );
		this.atlas = atlas;
		this.settings = { ...defaults, ...options };
		if ( Object.keys( options ).some( key => ! Object.hasOwn( defaults, key ) )
			|| Object.values( this.settings ).some( value => ! Number.isFinite( value ) || value <= 0 ) ) fail( 'Invalid marking settings' );
		this.approaches = new MarkingApproaches( atlas );
		this.edges = new Map( ( atlas.streets?.edges ?? [] ).map( edge => [ edge.id, edge ] ) );
		this.lanes = new Map();
		this.byEdge = new Map();
		this.primitives = [];
		this.omitted = [];
		if ( ! Array.isArray( road?.lanes ) ) fail( 'Missing marking lane network' );
		for ( const lane of road.lanes ) {

			if ( ! lane?.id || this.lanes.has( lane.id ) || ! this.edges.has( lane.edgeId ) || ! Number.isFinite( lane.width ) || lane.width <= this.settings.lineWidth * 2
				|| ! Array.isArray( lane.path3 ) || lane.path3.length < 2 || lane.path3.some( point => ! Array.isArray( point ) || point.length !== 3 || point.some( value => ! Number.isFinite( value ) ) ) ) fail( 'Invalid marking lane' );
			if ( ( lane.sourceDirection !== undefined || lane.sourceOffset !== undefined )
				&& ( ! [ 'forward', 'backward' ].includes( lane.sourceDirection ) || ! Number.isFinite( lane.sourceOffset ) ) ) fail( 'Invalid marking lane source' );
			if ( lane.next !== undefined && ( ! Array.isArray( lane.next ) || lane.next.some( connection => ! connection?.laneId || ! [ 's', 'l', 'r', 't' ].includes( connection.turn ) ) ) ) fail( 'Invalid marking lane connectivity' );
			const record = { lane, path: new MarkingPath( lane.path3 ) };
			this.lanes.set( lane.id, record );
			if ( ! this.byEdge.has( lane.edgeId ) ) this.byEdge.set( lane.edgeId, [] );
			this.byEdge.get( lane.edgeId ).push( record );

		}

	}

	build() {

		this.primitives = [];
		this.omitted = [];
		for ( const [ edgeId, lanes ] of this.byEdge ) {

			if ( this.approaches.internal.has( edgeId ) ) continue;
			const authored = lanes.every( record => record.lane.sourceDirection );
			if ( ! authored && lanes.some( record => record.lane.sourceDirection ) ) fail( 'Mixed lane source authority on one street' );
			if ( authored ) this.authored( edgeId, lanes );
			else this.legacy( edgeId, lanes );

		}
		this.crossings();
		return { primitives: Object.freeze( this.primitives ), omitted: Object.freeze( this.omitted ) };

	}

	authored( edgeId, lanes ) {

		const ordered = [ ...lanes ].sort( ( a, b ) => b.lane.sourceOffset - a.lane.sourceOffset );
		const canonical = record => new MarkingPath( record.lane.sourceDirection === 'forward' ? record.lane.path3 : [ ...record.lane.path3 ].reverse() );
		const s = this.settings;
		const planes = this.approaches.planes( edgeId );
		for ( let i = 0; i < ordered.length; i ++ ) {

			const record = ordered[ i ];
			const lane = record.lane;
			const source = canonical( record );
			const previous = ordered[ i - 1 ];
			const next = ordered[ i + 1 ];
			if ( i === 0 ) this.line( source.offset( lane.width / 2 - s.edgeInset ), planes, 'edge', edgeId );
			if ( ! next ) this.line( source.offset( - lane.width / 2 + s.edgeInset ), planes, 'edge', edgeId );
			else {

				const boundary = lane.sourceOffset - lane.width / 2;
				const separation = boundary - next.lane.sourceOffset - next.lane.width / 2;
				if ( separation < - 1e-6 ) fail( 'Lane boundaries overlap' );
				if ( separation > 1e-6 ) {

					this.line( source.offset( - lane.width / 2 + s.edgeInset ), planes, 'edge', edgeId );
					this.line( canonical( next ).offset( next.lane.width / 2 - s.edgeInset ), planes, 'edge', edgeId );

				} else if ( lane.sourceDirection === next.lane.sourceDirection ) {

					const stop = this.incoming( lane );
					const limits = planes.map( plane => plane === stop ? { ...plane, distance: plane.distance + s.stopSetback + s.stopWidth } : plane );
					this.line( source.offset( - lane.width / 2 ), limits, 'divider', edgeId, true );

				} else {

					const carrier = source.offset( - lane.width / 2 );
					for ( const direction of [ - 1, 1 ] ) this.line( carrier.offset( direction * ( s.centerGap + s.lineWidth ) / 2 ), planes, 'center', edgeId );

				}

			}
			const sameLeft = shared( previous?.lane, lane );
			const sameRight = shared( lane, next?.lane );
			this.approachMarks( record, lane.sourceDirection === 'forward' ? [ sameLeft, sameRight ] : [ sameRight, sameLeft ] );

		}

	}

	legacy( edgeId, records ) {

		const emitted = new Set();
		for ( const { lane, path } of records ) {

			for ( const [ direction, sign ] of [ [ 'left', 1 ], [ 'right', - 1 ] ] ) {

				const adjacent = lane[ direction ];
				const key = adjacent ? [ lane.id, adjacent.laneId ].sort().join( ':' ) : `${lane.id}:${direction}`;
				if ( emitted.has( key ) ) continue;
				emitted.add( key );
				this.line( path.offset( sign * ( lane.width / 2 - ( adjacent ? 0 : this.settings.edgeInset ) ) ), [], adjacent ? 'divider' : 'edge', edgeId, !! adjacent?.change );

			}

		}

	}

	line( path, planes, kind, edgeId, dashed = false ) {

		const s = this.settings;
		for ( const [ from, to ] of path.intervals( planes, s.crossingClearance ) ) {

			if ( dashed ) {

				const count = Math.floor( ( to - from + s.dashGap ) / ( s.dashLength + s.dashGap ) );
				const margin = ( to - from - ( count * s.dashLength + ( count - 1 ) * s.dashGap ) ) / 2;
				for ( let i = 0; i < count; i ++ ) {

					const start = from + margin + i * ( s.dashLength + s.dashGap );
					const polygons = path.strip( start, start + s.dashLength, s.lineWidth );
					if ( fits( polygons, planes, s.crossingClearance ) ) this.add( kind, edgeId, polygons );

				}

			} else this.add( kind, edgeId, path.strip( from, to, s.lineWidth ).map( polygon => clipPlanes( polygon, planes, s.crossingClearance ) ).filter( polygon => polygon.length ) );

		}

	}

	incoming( lane ) {

		const edge = this.edges.get( lane.edgeId );
		const nodeId = lane.sourceDirection === 'forward' ? edge.to : edge.from;
		return this.approaches.planes( edge.id ).find( plane => plane.nodeId === nodeId );

	}

	approachMarks( { lane, path }, shared ) {

		if ( ! this.incoming( lane ) ) return;
		const planes = this.approaches.planes( lane.edgeId );
		const s = this.settings;
		const intervals = path.intervals( planes );
		if ( ! intervals.length ) return;
		const [ from, end ] = intervals.at( - 1 );
		const margins = shared.map( same => same ? 0 : s.edgeInset + s.lineWidth );
		const stopEnd = end - s.stopSetback;
		const stopStart = stopEnd - s.stopWidth;
		if ( stopStart > from ) {

			const polygons = path.strip( stopStart, stopEnd, lane.width - margins[ 0 ] - margins[ 1 ], ( margins[ 1 ] - margins[ 0 ] ) / 2 );
			if ( fits( polygons, planes, s.crossingClearance ) ) this.add( 'stop', lane.edgeId, polygons, { laneId: lane.id } );

		}
		const turns = [ ...new Set( ( lane.next ?? [] ).map( connection => connection.turn ).filter( turn => [ 's', 'l', 'r' ].includes( turn ) ) ) ].sort();
		if ( ! turns.length ) return;
		const start = stopStart - s.arrowSetback - s.arrowLength;
		const finish = start + s.arrowLength;
		if ( start <= from || path.at( start ).segment !== path.at( finish ).segment || s.arrowWidth > lane.width - 2 * ( s.edgeInset + s.lineWidth ) ) {

			this.omitted.push( { kind: 'arrow', laneId: lane.id, reason: 'complete-glyph-does-not-fit' } );
			return;

		}
		const heading = path.at( start ).tangent;
		const polygons = arrowPolygons( turns, s.arrowLength, s.arrowWidth ).map( polygon => polygon.map( ( [ across, along ] ) => {

			const point = path.at( start + along ).point;
			return [ point[ 0 ] + heading[ 1 ] * across, point[ 1 ], point[ 2 ] - heading[ 0 ] * across ];

		} ) );
		if ( fits( polygons, planes, s.crossingClearance ) ) this.add( 'arrow', lane.edgeId, polygons, { laneId: lane.id, turns } );

	}

	crossings() {

		for ( const crossing of this.atlas.streets?.crossings ?? [] ) {

			if ( ! Array.isArray( crossing?.segments ) ) fail( 'Invalid crossing marking source' );
			for ( const segment of crossing.segments ) {

				const edge = this.edges.get( segment.edgeId );
				if ( ! edge || ! Array.isArray( segment.markings ) || segment.markings.some( polygon => ! Array.isArray( polygon ) || polygon.length < 3
					|| polygon.some( point => ! Array.isArray( point ) || point.length !== 2 || point.some( value => ! Number.isFinite( value ) ) ) ) ) fail( 'Invalid crossing marking source' );
				const approach = this.approaches.planes( edge.id ).find( plane => plane.nodeId === crossing.nodeId );
				const profile = edge.elevationProfile;
				if ( ! Array.isArray( profile ) || ! profile.length || profile.some( point => ! Number.isFinite( point.distance ) || ! Number.isFinite( point.level ) ) ) fail( 'Crossing has no elevation profile' );
				let height = profile[ 0 ].level;
				if ( approach ) height = profileHeight( profile, approach.source.distance );
				else if ( profile.some( point => point.level !== height ) ) fail( 'Legacy crossing has no constant surface height' );
				this.add( 'crossing', edge.id, segment.markings.map( polygon => polygon.map( ( [ x, z ] ) => [ x, height, z ] ) ), { nodeId: crossing.nodeId } );

			}

		}

	}

	add( kind, edgeId, polygons, extra = {} ) {

		if ( ! polygons.length ) return;
		this.primitives.push( Object.freeze( { kind, edgeId, ...extra, finish: kind === 'center' || kind === 'crossing' ? 'accent' : 'white', polygons } ) );

	}

}

const fits = ( polygons, planes, margin ) => polygons.every( polygon => polygon.every( point => planes.every( plane => side( point, plane ) >= margin - 1e-8 ) ) );
const shared = ( left, right ) => left && right && left.sourceDirection === right.sourceDirection
	&& Math.abs( left.sourceOffset - left.width / 2 - right.sourceOffset - right.width / 2 ) < 1e-6;
function profileHeight( profile, station ) {
	for ( let i = 1; i < profile.length; i ++ ) {
		if ( station > profile[ i ].distance ) continue;
		const a = profile[ i - 1 ], b = profile[ i ];
		return a.level + ( b.level - a.level ) * ( station - a.distance ) / ( b.distance - a.distance );
	}
	return profile.at( - 1 ).level;
}
