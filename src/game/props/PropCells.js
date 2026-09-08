import { bounds } from './Footprints.js';

/** Whole admitted placements belong to one spatial owner; queries preserve source order. */
export class PropCells {
	constructor( placements, cellSize ) {
		this.cellSize = cellSize; this.cells = new Map(); this.reach = 0;
		placements.forEach( ( item, order ) => {
			const x = item.matrix.elements[ 12 ], z = item.matrix.elements[ 14 ];
			const cx = Math.floor( x / cellSize ), cz = Math.floor( z / cellSize ), id = `${cx}:${cz}`;
			if ( ! this.cells.has( id ) ) this.cells.set( id, { id, items: [], bounds: { minX: Infinity, maxX: - Infinity, minZ: Infinity, maxZ: - Infinity } } );
			const cell = this.cells.get( id ), box = bounds( item.footprint );
			cell.items.push( { item, order } );
			cell.bounds.minX = Math.min( cell.bounds.minX, box.minX ); cell.bounds.maxX = Math.max( cell.bounds.maxX, box.maxX );
			cell.bounds.minZ = Math.min( cell.bounds.minZ, box.minZ ); cell.bounds.maxZ = Math.max( cell.bounds.maxZ, box.maxZ );
			this.reach = Math.max( this.reach, Math.abs( box.minX - x ), Math.abs( box.maxX - x ), Math.abs( box.minZ - z ), Math.abs( box.maxZ - z ) );
		} );
	}
	near( point, radius ) {
		const out = new Map(), extent = radius + this.reach;
		for ( let x = Math.floor( ( point.x - extent ) / this.cellSize ); x <= Math.floor( ( point.x + extent ) / this.cellSize ); x ++ ) {
			for ( let z = Math.floor( ( point.z - extent ) / this.cellSize ); z <= Math.floor( ( point.z + extent ) / this.cellSize ); z ++ ) {
				const cell = this.cells.get( `${x}:${z}` );
				if ( ! cell ) continue;
				const dx = Math.max( cell.bounds.minX - point.x, 0, point.x - cell.bounds.maxX );
				const dz = Math.max( cell.bounds.minZ - point.z, 0, point.z - cell.bounds.maxZ );
				if ( dx * dx + dz * dz <= radius * radius ) out.set( cell.id, cell );
			}
		}
		return out;
	}
	items( cells ) {
		return [ ...cells.values() ].flatMap( cell => cell.items ).sort( ( a, b ) => a.order - b.order ).map( entry => entry.item );
	}
}
