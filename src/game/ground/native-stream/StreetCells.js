import { Matrix4, Vector3 } from 'three/webgpu';

const _scale = new Vector3();

/**
 * The bundle's placements grouped into its own cells.
 *
 * A cell is what the placement table says it is: every placement whose origin
 * falls in the same 128 m square. Pieces are never cut at a boundary, so each
 * cell also keeps the exact rectangle its geometry covers, and residency
 * measures distance to that rectangle rather than to the square.
 */
export class StreetCells {

	constructor( kit, placements ) {
		const pieces = new Map( kit.pieces.map( piece => [ piece.id, piece ] ) );
		this.cells = new Map();
		for ( const placement of placements ) {
			const key = `${placement.cell[ 0 ]}:${placement.cell[ 1 ]}`;
			if ( ! this.cells.has( key ) ) this.cells.set( key, { key, placements: [], min: [ Infinity, Infinity ], max: [ - Infinity, - Infinity ] } );
			const cell = this.cells.get( key );
			cell.placements.push( placement );
			cover( cell, pieces.get( placement.piece ), placement );
		}
		const cells = [ ...this.cells.values() ];
		this.bounds = {
			min: [ 0, 1 ].map( axis => Math.min( ...cells.map( cell => cell.min[ axis ] ) ) ),
			max: [ 0, 1 ].map( axis => Math.max( ...cells.map( cell => cell.max[ axis ] ) ) )
		};
	}

	/** Cells whose geometry reaches within `radius` of the point, nearest first. */
	near( x, z, radius ) {
		return [ ...this.cells.values() ]
			.map( cell => [ cell, distance( cell, x, z ) ] )
			.filter( ( [ , metres ] ) => metres <= radius )
			.sort( ( a, b ) => a[ 1 ] - b[ 1 ] );
	}

}

/** Piece to world: the placement's scale, then its yaw, then its position. */
export function placementMatrix( placement, target = new Matrix4() ) {
	target.makeRotationY( placement.rotationY );
	if ( placement.scale ) target.scale( _scale.fromArray( placement.scale ) );
	return target.setPosition( placement.position[ 0 ], placement.position[ 1 ], placement.position[ 2 ] );
}

/** One placement's cuboids in world coordinates, appended in place. */
export function placementBoxes( placement, boxes, out ) {
	const [ x, y, z ] = placement.position, [ sx, sy, sz ] = placement.scale ?? [ 1, 1, 1 ];
	const cos = Math.cos( placement.rotationY ), sin = Math.sin( placement.rotationY );
	for ( const box of boxes ) {
		const [ bx, by, bz ] = box.center, [ hx, hy, hz ] = box.halfExtents;
		out.push( {
			center: [ x + cos * bx * sx + sin * bz * sz, y + by * sy, z - sin * bx * sx + cos * bz * sz ],
			halfExtents: [ hx * sx, hy * sy, hz * sz ],
			rotationY: placement.rotationY
		} );
	}
	return out;
}

/** Grows the cell rectangle over the ground this placement's piece covers. */
function cover( cell, piece, placement ) {
	if ( ! piece ) return;
	const [ x, , z ] = placement.position, [ sx, , sz ] = placement.scale ?? [ 1, 1, 1 ];
	const cos = Math.cos( placement.rotationY ), sin = Math.sin( placement.rotationY );
	for ( const cx of [ piece.bounds.min[ 0 ] * sx, piece.bounds.max[ 0 ] * sx ] ) {
		for ( const cz of [ piece.bounds.min[ 2 ] * sz, piece.bounds.max[ 2 ] * sz ] ) {
			const wx = x + cos * cx + sin * cz, wz = z - sin * cx + cos * cz;
			cell.min[ 0 ] = Math.min( cell.min[ 0 ], wx ); cell.max[ 0 ] = Math.max( cell.max[ 0 ], wx );
			cell.min[ 1 ] = Math.min( cell.min[ 1 ], wz ); cell.max[ 1 ] = Math.max( cell.max[ 1 ], wz );
		}
	}
}

function distance( cell, x, z ) {
	return Math.hypot( Math.max( cell.min[ 0 ] - x, 0, x - cell.max[ 0 ] ), Math.max( cell.min[ 1 ] - z, 0, z - cell.max[ 1 ] ) );
}
