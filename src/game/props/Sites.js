import { signedArea } from '../ground/Polygons.js';
import { pointDistance, SpatialIndex } from './Footprints.js';
import { Rng } from '../../city/Rng.js';
import { seedOf } from './Placement.js';

/** Authored planting points and usable lengths of rear facades. */
export class Sites {
	constructor( atlas ) { this.atlas = atlas; }
	all() {
		const trees = ( this.atlas.streets.planting ?? [] ).filter( point => point.kind === 'tree' ).map( ( point, i ) => ( { id: `tree:${point.edgeId}:${i}`, kind: 'tree', x: point.position[ 0 ], z: point.position[ 1 ], nx: 0, nz: 1 } ) );
		const facades = new SpatialIndex(), yards = [], pockets = [];
		for ( const parcel of this.atlas.parcels ) for ( let i = 0; i < parcel.footprint.length; i ++ ) {
			const a = parcel.footprint[ i ], b = parcel.footprint[ ( i + 1 ) % parcel.footprint.length ];
			facades.add( [ a, b ], { a, b, id: parcel.id } );
		}
		for ( const parcel of this.atlas.parcels ) {
			const industrial = this.atlas.districts?.find( d => d.id === parcel.districtId )?.kind === 'industrial' || parcel.type === 'factory';
			const ring = parcel.footprint, sign = signedArea( ring ) > 0 ? 1 : - 1;
			for ( let i = 0; i < ring.length; i ++ ) {
				const a = ring[ i ], b = ring[ ( i + 1 ) % ring.length ];
				const length = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
				if ( length < 3 ) continue;
				const tx = ( b[ 0 ] - a[ 0 ] ) / length, tz = ( b[ 1 ] - a[ 1 ] ) / length, nx = tz * sign, nz = - tx * sign;
				const rng = new Rng( seedOf( `${this.atlas.meta.seed}:sites:${parcel.id}:${i}` ) );
				let station = 0;
				for ( let along = rng.range( 2, 6 ); along < length - 1; along += rng.range( 11, 21 ) ) {
					const x = a[ 0 ] + tx * along, z = a[ 1 ] + tz * along;
					if ( Math.hypot( x - parcel.access.point[ 0 ], z - parcel.access.point[ 1 ] ) < 10 ) continue;
					const point = [ x + nx, z + nz ];
					const gap = [ ...facades.query( [ point ], 6 ) ].some( wall => wall.id !== parcel.id && pointDistance( point, wall.a, wall.b ) < 6 );
					pockets.push( { id: `${parcel.id}:${i}:${station ++}`, owner: parcel.id, x, z, nx, nz, kind: gap ? 'gap' : 'corner' } );
				}
				if ( industrial ) for ( let along = rng.range( 7, 11 ); along < length - 6; along += rng.range( 16, 25 ) ) {
					const x = a[ 0 ] + tx * along, z = a[ 1 ] + tz * along;
					if ( Math.hypot( x - parcel.access.point[ 0 ], z - parcel.access.point[ 1 ] ) > 12 ) yards.push( { id: `${parcel.id}:yard:${i}:${station ++}`, owner: parcel.id, x, z, nx, nz, kind: 'yard' } );
				}
			}
		}
		return [ ...trees, ...yards, ...pockets ];
	}
}
