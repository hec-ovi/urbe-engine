/** Bounds index retaining source order and every overlapping record. */
export class StreetFixtureIndex {

	constructor( cellSize = 32 ) { this.cellSize = cellSize; this.cells = new Map(); this.count = 0; }

	add( value, points, padding = 0 ) {

		let minX = Infinity, minZ = Infinity, maxX = - Infinity, maxZ = - Infinity;
		for ( const [ x, z ] of points ) {
			minX = Math.min( minX, x ); maxX = Math.max( maxX, x );
			minZ = Math.min( minZ, z ); maxZ = Math.max( maxZ, z );
		}
		const record = { value, order: this.count ++, minX: minX - padding, minZ: minZ - padding, maxX: maxX + padding, maxZ: maxZ + padding };
		for ( const key of this.#keys( record ) ) {
			if ( ! this.cells.has( key ) ) this.cells.set( key, [] );
			this.cells.get( key ).push( record );
		}

	}

	near( x, z, radius = 0 ) {

		return this.query( { minX: x - radius, minZ: z - radius, maxX: x + radius, maxZ: z + radius } );

	}

	query( box ) {

		const found = new Set();
		for ( const key of this.#keys( box ) ) for ( const record of this.cells.get( key ) ?? [] ) {
			if ( record.maxX >= box.minX && record.minX <= box.maxX && record.maxZ >= box.minZ && record.minZ <= box.maxZ ) found.add( record );
		}
		return [ ...found ].sort( ( a, b ) => a.order - b.order ).map( record => record.value );

	}

	*#keys( { minX, minZ, maxX, maxZ } ) {

		for ( let x = Math.floor( minX / this.cellSize ); x <= Math.floor( maxX / this.cellSize ); x ++ ) {
			for ( let z = Math.floor( minZ / this.cellSize ); z <= Math.floor( maxZ / this.cellSize ); z ++ ) yield `${x}:${z}`;
		}

	}

}
