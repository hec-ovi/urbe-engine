import { SIDEWALK_HEIGHT } from '../ground/GroundBuilder.js';
import { area, distance, intersectionArea, SpatialIndex } from './Footprints.js';

export const CLEARANCE = { door: 3.5, walk: 0.25, pile: 1.8 };
const LAND = new Set( [ 'sidewalk', 'block', 'open' ] );

/** Admits complete arrangements against authored land, solid volumes and route widths. */
export class Clearance {
	constructor( atlas, walk, obstacles = [] ) {
		this.ground = new SpatialIndex(); this.obstacles = new SpatialIndex(); this.claimed = new SpatialIndex();
		for ( const obstacle of obstacles ) this.block( obstacle.footprint, obstacle.bottom, obstacle.top, 0.1 );
		for ( const cover of atlas.volumetric?.ground ?? [] ) this.ground.add( cover.polygon, { ...cover, top: cover.top ?? ( cover.surface === 'roadway' ? 0 : SIDEWALK_HEIGHT ) } );
		for ( const parcel of atlas.parcels ) {
			this.block( parcel.footprint, - Infinity, Infinity, 0.08 );
			this.block( [ parcel.access.point ], - Infinity, Infinity, CLEARANCE.door );
		}
		for ( const edge of walk?.edges ?? [] ) {
			for ( let i = 0; i < edge.path3.length - 1; i ++ ) {
				const a = edge.path3[ i ], b = edge.path3[ i + 1 ];
				this.block( [ [ a[ 0 ], a[ 2 ] ], [ b[ 0 ], b[ 2 ] ] ], Math.min( a[ 1 ], b[ 1 ] ) - 0.05, Math.max( a[ 1 ], b[ 1 ] ) + 2.4, edge.width / 2 + CLEARANCE.walk, 'walk' );
			}
		}
		for ( const point of atlas.streets.planting ?? [] ) if ( point.kind !== 'tree' ) this.block( [ point.position ], - Infinity, Infinity, 0.45 );
		for ( const structure of atlas.streets.highwayStructures ?? [] ) for ( const support of structure.supports ) this.block( support.footprint, support.bottom, support.top, 0.1 );
		for ( const station of atlas.transit?.subwayStations ?? [] ) {
			for ( const bay of station.entranceBays ?? [] ) this.block( bay.footprint, - Infinity, Infinity, 0.5 );
			for ( const shaft of station.shafts ?? [] ) this.block( shaft.footprint, - Infinity, Infinity, 0.5 );
		}
	}
	block( ring, bottom, top, margin, kind = 'solid' ) { this.obstacles.add( ring, { ring, bottom, top, margin, kind }, margin ); }
	support( ring, yard ) {
		const covered = new Map(), target = area( ring );
		for ( const cover of this.ground.query( ring ) ) {
			if ( ! LAND.has( cover.surface ) || ( yard && ! [ 'block', 'open' ].includes( cover.surface ) ) ) continue;
			covered.set( cover.top, ( covered.get( cover.top ) ?? 0 ) + intersectionArea( cover.polygon, ring ) );
		}
		for ( const [ top, value ] of covered ) if ( Math.abs( target - value ) <= Math.max( 1e-7, target * 1e-7 ) ) return top;
		return null;
	}
	claim( placements, yard = false ) {
		let elevation = null;
		for ( let i = 0; i < placements.length; i ++ ) for ( let j = i + 1; j < placements.length; j ++ ) {
			const a = placements[ i ], b = placements[ j ];
			if ( Math.min( a.top, b.top ) - Math.max( a.bottom, b.bottom ) > 1e-7 && intersectionArea( a.footprint, b.footprint ) > 1e-8 ) return null;
		}
		for ( const item of placements ) {
			const top = this.support( item.support, yard );
			if ( top === null || ( elevation !== null && Math.abs( elevation - top ) > 1e-6 ) ) return null;
			elevation = top;
			const obstacles = new Set( [ ...this.obstacles.query( item.footprint ), ...this.obstacles.query( item.support ) ] );
			for ( const obstacle of obstacles ) {
				const ring = obstacle.kind === 'walk' && item.kind === 'tree' ? item.lowFootprint : item.footprint;
				if ( top + item.top <= obstacle.bottom || top + item.bottom >= obstacle.top ) continue;
				if ( distance( ring, obstacle.ring ) <= obstacle.margin || distance( item.support, obstacle.ring ) <= obstacle.margin ) return null;
			}
			for ( const other of this.claimed.query( item.footprint, CLEARANCE.pile ) ) if ( distance( item.footprint, other ) < CLEARANCE.pile ) return null;
		}
		for ( const item of placements ) this.claimed.add( item.footprint, item.footprint );
		return elevation;
	}
}
