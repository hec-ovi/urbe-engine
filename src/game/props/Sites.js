import { signedArea } from '../ground/Polygons.js';
import { pointDistance, SpatialIndex } from './Footprints.js';

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
				for ( let along = 2; along < length - 1; along += 14 ) {
					const x = a[ 0 ] + tx * along, z = a[ 1 ] + tz * along;
					if ( Math.hypot( x - parcel.access.point[ 0 ], z - parcel.access.point[ 1 ] ) < 10 ) continue;
					const point = [ x + nx, z + nz ];
					const gap = [ ...facades.query( [ point ], 6 ) ].some( wall => wall.id !== parcel.id && pointDistance( point, wall.a, wall.b ) < 6 );
					pockets.push( { id: `${parcel.id}:${i}:${along}`, x, z, nx, nz, kind: gap ? 'gap' : 'corner' } );
				}
				if ( industrial ) for ( let along = 7; along < length - 6; along += 16 ) {
					const x = a[ 0 ] + tx * along, z = a[ 1 ] + tz * along;
					if ( Math.hypot( x - parcel.access.point[ 0 ], z - parcel.access.point[ 1 ] ) > 12 ) yards.push( { id: `${parcel.id}:yard:${i}:${along}`, x, z, nx, nz, kind: 'yard' } );
				}
			}
		}
		return [ ...trees, ...yards, ...pockets ];
	}
}
