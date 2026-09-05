import { GroundBuilder } from '../ground/GroundBuilder.js';

/** Fits a pole's complete circular base in authored furnishing land. */
export class StreetLampSeats {

	constructor( atlas ) {

		this.active = Boolean( atlas.streets?.construction?.paving );
		this.covers = GroundBuilder.regionFootprints( atlas, 'furnishing' ).flatMap( ( { covers } ) => covers.map( ( { polygon } ) => ( {
			polygon,
			minX: Math.min( ...polygon.map( point => point[ 0 ] ) ),
			maxX: Math.max( ...polygon.map( point => point[ 0 ] ) ),
			minZ: Math.min( ...polygon.map( point => point[ 1 ] ) ),
			maxZ: Math.max( ...polygon.map( point => point[ 1 ] ) )
		} ) ) );

	}

	allows( x, z, radius ) {

		if ( ! this.active ) return true;
		let area = 0;
		for ( const cover of this.covers ) {

			if ( x + radius < cover.minX || x - radius > cover.maxX
				|| z + radius < cover.minZ || z - radius > cover.maxZ ) continue;
			area += circleArea( cover.polygon, x, z, radius );

		}
		const required = Math.PI * radius * radius;
		return area >= required * ( 1 - 1e-8 );

	}

}

/** Area of a disk intersected with one simple polygon, using exact arc integrals. */
function circleArea( polygon, x, z, radius ) {

	let area = 0;
	for ( let index = 0; index < polygon.length; index ++ ) {

		const a = polygon[ index ];
		const b = polygon[ ( index + 1 ) % polygon.length ];
		area += segmentArea( a[ 0 ] - x, a[ 1 ] - z, b[ 0 ] - x, b[ 1 ] - z, radius );

	}
	return Math.abs( area );

}

function segmentArea( ax, az, bx, bz, radius ) {

	const dx = bx - ax;
	const dz = bz - az;
	const length2 = dx * dx + dz * dz;
	if ( length2 === 0 ) return 0;
	const projection = ax * dx + az * dz;
	const radius2 = radius * radius;
	const determinant = projection * projection - length2 * ( ax * ax + az * az - radius2 );
	const cuts = [ 0, 1 ];
	if ( determinant > 0 ) {

		const root = Math.sqrt( determinant );
		for ( const value of [ ( - projection - root ) / length2, ( - projection + root ) / length2 ] ) {

			if ( value > 0 && value < 1 ) cuts.push( value );

		}

	}
	cuts.sort( ( a, b ) => a - b );
	let area = 0;
	for ( let index = 0; index < cuts.length - 1; index ++ ) {

		const from = cuts[ index ];
		const to = cuts[ index + 1 ];
		const px = ax + dx * from;
		const pz = az + dz * from;
		const qx = ax + dx * to;
		const qz = az + dz * to;
		const middle = ( from + to ) / 2;
		const mx = ax + dx * middle;
		const mz = az + dz * middle;
		const cross = px * qz - pz * qx;
		area += mx * mx + mz * mz <= radius2
			? cross / 2
			: radius2 * Math.atan2( cross, px * qx + pz * qz ) / 2;

	}
	return area;

}
