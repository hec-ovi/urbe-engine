import { fail } from './GroundRegions.js';
import { pair } from './PavingFrame.js';

/** Expands only the integer cells supplied by Atlas. */
export class PavingCells {

	constructor( frame, module, spans ) {

		if ( ! module || ! pair( module.pitch ) || ! pair( module.joint )
			|| module.pitch.some( ( pitch, i ) => pitch <= 0 || module.joint[ i ] < 0 || module.joint[ i ] >= pitch ) ) fail( 'Invalid paving module dimensions' );
		if ( ! Array.isArray( spans ) || ! spans.length ) fail( 'Missing paving cells' );
		this.frame = frame;
		this.module = module;
		this.spans = spans;
		this.rows = new Map();
		let previous;
		for ( const span of spans ) {

			if ( ! span || ! [ span.row, span.from, span.to, span.row + 1, span.to + 1 ].every( Number.isSafeInteger ) || span.from >= span.to
				|| ( previous && ( span.row < previous.row || ( span.row === previous.row && span.from < previous.to ) ) ) ) fail( 'Invalid or overlapping paving cell spans' );
			if ( ! this.rows.has( span.row ) ) this.rows.set( span.row, [] );
			this.rows.get( span.row ).push( span );
			previous = span;
			frame.corner( span.from, span.row, module.pitch );
			frame.corner( span.to, span.row + 1, module.pitch );

		}

	}

	forEach( visit ) {

		const { pitch, joint } = this.module;
		const u = cuts( pitch[ 0 ], joint[ 0 ] );
		const v = cuts( pitch[ 1 ], joint[ 1 ] );
		for ( const { row, from, to } of this.spans ) {

			for ( let column = from; column < to; column ++ ) {

				const q = [ [ column, row ], [ column + 1, row ], [ column + 1, row + 1 ], [ column, row + 1 ] ]
					.map( ( [ c, r ] ) => this.frame.corner( c, r, pitch ) );
				const points = v.map( t => u.map( s => bilinear( q, s, t ) ) );
				const boundary = [ ! this.has( column, row - 1 ), ! this.has( column + 1, row ),
					! this.has( column, row + 1 ), ! this.has( column - 1, row ) ];
				const pieces = [];
				const piece = ( role, left, bottom, right, top ) => {

					if ( u[ left ] === u[ right ] || v[ bottom ] === v[ top ] ) return;
					const polygon = [ points[ bottom ][ left ], points[ bottom ][ right ], points[ top ][ right ], points[ top ][ left ] ];
					const exposed = [ v[ bottom ] === 0, u[ right ] === 1, v[ top ] === 1, u[ left ] === 0 ]
						.map( ( edge, i ) => edge && boundary[ i ] );
					pieces.push( { role, polygon, exposed } );

				};
				piece( 'body', 1, 1, 2, 2 );
				// Both wide strips retain the body's edge stations as real vertices.
				// This keeps shared boundaries identical after Float32 conversion.
				for ( let i = 0; i < 3; i ++ ) {

					piece( 'joint', i, 0, i + 1, 1 );
					piece( 'joint', i, 2, i + 1, 3 );

				}
				piece( 'joint', 0, 1, 1, 2 );
				piece( 'joint', 2, 1, 3, 2 );
				visit( pieces );

			}

		}

	}

	has( column, row ) {

		const spans = this.rows.get( row ) ?? [];
		let low = 0;
		let high = spans.length;
		while ( low < high ) {

			const middle = ( low + high ) >>> 1;
			if ( spans[ middle ].to <= column ) low = middle + 1;
			else high = middle;

		}
		return low < spans.length && spans[ low ].from <= column;

	}

}

const cuts = ( pitch, joint ) => [ 0, joint / ( 2 * pitch ), 1 - joint / ( 2 * pitch ), 1 ];
const lerp = ( a, b, t ) => t === 0 ? a : t === 1 ? b : a + ( b - a ) * t;
const bilinear = ( q, u, v ) => [ 0, 1 ].map( axis => lerp( lerp( q[ 0 ][ axis ], q[ 1 ][ axis ], u ), lerp( q[ 3 ][ axis ], q[ 2 ][ axis ], u ), v ) );
