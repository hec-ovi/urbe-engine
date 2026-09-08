/** Spatial ownership and complete footprint distance for shell admission. */
export class ShellCells {

	constructor( records, size ) {

		this.cells = new Map();
		for ( const record of records ) {

			const id = `${Math.floor( record.center[ 0 ] / size )}:${Math.floor( record.center[ 2 ] / size )}`;
			if ( ! this.cells.has( id ) ) this.cells.set( id, { id, records: [], min: [ Infinity, Infinity ], max: [ - Infinity, - Infinity ] } );
			const cell = this.cells.get( id );
			cell.records.push( record );
			for ( const [ axis, component ] of [ [ 0, 0 ], [ 1, 2 ] ] ) {

				cell.min[ axis ] = Math.min( cell.min[ axis ], record.bounds.min[ component ] );
				cell.max[ axis ] = Math.max( cell.max[ axis ], record.bounds.max[ component ] );

			}

		}

	}

	distance( cell, position ) {

		return Math.hypot( Math.max( cell.min[ 0 ] - position.x, 0, position.x - cell.max[ 0 ] ),
			Math.max( cell.min[ 1 ] - position.z, 0, position.z - cell.max[ 1 ] ) );

	}

}
