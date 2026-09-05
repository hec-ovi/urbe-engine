import { fail } from './GroundRegions.js';

/** Atlas frame arithmetic shared by cell corners and metre-scale UVs. */
export class PavingFrame {

	constructor( frame ) {

		if ( ! pair( frame.origin ) || ! pair( frame.u ) || frame.gridStep !== 0.001
			|| Math.abs( Math.hypot( ...frame.u ) - 1 ) > 1e-8 ) fail( `Invalid paving frame: ${frame.id}` );
		this.origin = frame.origin;
		this.u = frame.u;

	}

	corner( column, row, pitch ) {

		const du = column * pitch[ 0 ];
		const dv = row * pitch[ 1 ];
		const x = ( this.origin[ 0 ] + this.u[ 0 ] * du ) - this.u[ 1 ] * dv;
		const z = ( this.origin[ 1 ] + this.u[ 1 ] * du ) + this.u[ 0 ] * dv;
		const point = [ Math.round( x * 1000 ) / 1000, Math.round( z * 1000 ) / 1000 ];
		if ( ! point.every( Number.isFinite ) ) fail( 'Paving corner is not finite' );
		return point;

	}

	uv( point ) {

		const x = point[ 0 ] - this.origin[ 0 ];
		const z = point[ 1 ] - this.origin[ 1 ];
		return [ x * this.u[ 0 ] + z * this.u[ 1 ], x * this.u[ 1 ] - z * this.u[ 0 ] ];

	}

	/** Canonical edge direction relative to this frame, retaining physical length. */
	faceU( a, b ) {

		const dx = b[ 0 ] - a[ 0 ];
		const dz = b[ 1 ] - a[ 1 ];
		const length = Math.hypot( dx, dz );
		const along = dx * this.u[ 0 ] + dz * this.u[ 1 ];
		const across = - dx * this.u[ 1 ] + dz * this.u[ 0 ];
		const sign = Math.sign( Math.abs( along ) >= Math.abs( across ) ? along : across );
		return [ a, b ].map( point => ( ( point[ 0 ] - this.origin[ 0 ] ) * dx
			+ ( point[ 1 ] - this.origin[ 1 ] ) * dz ) * sign / length );

	}

}

export const pair = value => Array.isArray( value ) && value.length === 2 && value.every( Number.isFinite );
