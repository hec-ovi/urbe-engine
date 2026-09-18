import * as THREE from 'three/webgpu';

/**
 * One cell's copies of the shared kit batches, appended only while the stream
 * shows the cell.
 *
 * The batches belong to the whole city, so a cell cannot hide its buildings by
 * hiding a group of its own: an instance in a batch is a building on screen.
 * The stream admits a cell hidden and turns it visible once the skyline that
 * replaces its impostors is standing, so this binds that same flag: nothing of
 * this cell reaches the batches until then, and a cell dropped before it is
 * ever shown appends nothing at all.
 */
export class KitCellInstances {

	/**
	 * @param pieces KitPieces
	 * @param buildings [{ placement, colour, swinging }]
	 */
	constructor( pieces, buildings ) {

		this.pieces = pieces;
		this.buildings = buildings;
		this.handles = null;

	}

	get standing() {

		return this.handles !== null;

	}

	/** Binds the group's visibility to these copies. @returns the group */
	bind( group ) {

		let visible = false;

		Object.defineProperty( group, 'visible', {
			configurable: true,
			get: () => visible,
			set: ( value ) => {

				if ( Boolean( value ) === visible ) return;
				visible = Boolean( value );
				if ( visible ) this.show(); else this.hide();

			}
		} );

		return group;

	}

	show() {

		if ( this.handles ) return;

		const handles = [];
		this.handles = handles;

		// The batches grow once for everything this cell places, so appending
		// its copies never reallocates part way through.
		this.pieces.reserve( this.buildings.flatMap( ( { placement } ) => placement.placements.map( ( piece ) => piece.piece ) ) );

		for ( const { placement, colour, swinging } of this.buildings ) {

			const entrance = placement.door?.placement ?? - 1;

			for ( const [ index, piece ] of placement.placements.entries() ) {

				handles.push( this.pieces.admit( piece.piece, placement.matrixOf( piece, _matrix ), colour, {
					swinging: swinging && index === entrance
				} ) );

			}

		}

	}

	hide() {

		if ( ! this.handles ) return;

		for ( const handle of this.handles ) this.pieces.release( handle );
		this.handles = null;

	}

}

const _matrix = new THREE.Matrix4();
