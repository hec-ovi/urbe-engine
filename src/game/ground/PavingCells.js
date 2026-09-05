import { fail } from './GroundRegions.js';
import { pair } from './PavingFrame.js';

/** Expands only the integer cells supplied by Atlas. */
export class PavingCells {

	constructor( frame, module, spans ) {

		const baseCells = module?.baseCells ?? [ 1, 1 ];
		if ( ! module || ! pair( module.pitch ) || ! pair( module.joint )
			|| ! pair( baseCells ) || baseCells.some( count => ! Number.isSafeInteger( count ) || count < 1 )
			|| module.pitch.some( ( pitch, i ) => pitch / baseCells[ i ] < 0.001 || module.joint[ i ] < 0 || module.joint[ i ] >= pitch / baseCells[ i ] ) ) fail( 'Invalid paving module dimensions' );
		if ( ! Array.isArray( spans ) || ! spans.length ) fail( 'Missing paving cells' );
		this.frame = frame;
		this.module = module;
		this.baseCells = baseCells;
		this.pitch = module.pitch.map( ( pitch, i ) => pitch / baseCells[ i ] );
		this.spans = spans;
		this.rows = new Map();
		let previous;
		for ( const span of spans ) {

			if ( ! span || ! [ span.row, span.from, span.to, span.row + 1, span.to + 1 ].every( Number.isSafeInteger ) || span.from >= span.to
				|| ( previous && ( span.row < previous.row || ( span.row === previous.row && span.from < previous.to ) ) ) ) fail( 'Invalid or overlapping paving cell spans' );
			if ( ! this.rows.has( span.row ) ) this.rows.set( span.row, [] );
			this.rows.get( span.row ).push( span );
			previous = span;
			if ( ! [ span.from * baseCells[ 0 ], span.to * baseCells[ 0 ], span.row * baseCells[ 1 ], ( span.row + 1 ) * baseCells[ 1 ] ].every( Number.isSafeInteger ) ) fail( 'Paving base index is not safe' );
			frame.corner( span.from * baseCells[ 0 ], span.row * baseCells[ 1 ], this.pitch );
			frame.corner( span.to * baseCells[ 0 ], ( span.row + 1 ) * baseCells[ 1 ], this.pitch );

		}

	}

	forEach( visit ) {

		const { joint } = this.module;
		const pitch = this.pitch;
		const [ columns, rows ] = this.baseCells;
		const u = cuts( pitch[ 0 ], joint[ 0 ] );
		const v = cuts( pitch[ 1 ], joint[ 1 ] );
		for ( const { row, from, to } of this.spans ) {

			for ( let column = from; column < to; column ++ ) {

				const outside = [ ! this.has( column, row - 1 ), ! this.has( column + 1, row ),
					! this.has( column, row + 1 ), ! this.has( column - 1, row ) ];
				for ( let j = 0; j < rows; j ++ ) for ( let i = 0; i < columns; i ++ ) {

					const c = column * columns + i;
					const r = row * rows + j;
					const q = [ [ c, r ], [ c + 1, r ], [ c + 1, r + 1 ], [ c, r + 1 ] ]
						.map( ( [ x, y ] ) => this.frame.corner( x, y, pitch ) );
					const points = v.map( t => u.map( s => bilinear( q, s, t ) ) );
					const groupEdge = [ j === 0, i === columns - 1, j === rows - 1, i === 0 ];
					const boundary = groupEdge.map( ( edge, index ) => edge && outside[ index ] );
					const pieces = [];
					// Every base boundary retains its joint-cut vertices. Internal cuts
					// remain body material, including beside smaller neighboring slabs.
					for ( let y = 0; y < 3; y ++ ) for ( let x = 0; x < 3; x ++ ) {

						if ( u[ x ] === u[ x + 1 ] || v[ y ] === v[ y + 1 ] ) continue;
						const role = ( y === 0 && groupEdge[ 0 ] ) || ( x === 2 && groupEdge[ 1 ] )
							|| ( y === 2 && groupEdge[ 2 ] ) || ( x === 0 && groupEdge[ 3 ] ) ? 'joint' : 'body';
						const polygon = [ points[ y ][ x ], points[ y ][ x + 1 ], points[ y + 1 ][ x + 1 ], points[ y + 1 ][ x ] ];
						const exposed = [ v[ y ] === 0, u[ x + 1 ] === 1, v[ y + 1 ] === 1, u[ x ] === 0 ]
							.map( ( edge, index ) => edge && boundary[ index ] );
						pieces.push( { role, polygon, exposed } );

					}
					visit( pieces );

				}

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
