/**
 * One cell's copies of the shared plan batches, appended only while the stream
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
	 * @param buildings [{ placement, colour, swinging, interior, sign, word }]
	 * @param signs KitSigns, which letters each parcel's own word on its
	 * building's sign field; null for a city that letters none
	 */
	constructor( pieces, buildings, signs = null ) {

		this.pieces = pieces;
		this.buildings = buildings;
		this.signs = signs;
		this.handles = null;
		this.lettered = null;

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
		this.pieces.reserve( this.buildings.map( ( { placement } ) => placement.plan ) );

		const lettered = [];
		this.lettered = lettered;

		for ( const { placement, colour, swinging, interior, sign, word } of this.buildings ) {

			handles.push( this.pieces.admit( placement.plan, placement.toWorld, colour, { swinging, interior } ) );

			const letters = sign && word ? this.signs?.admit( sign, word ) : null;

			if ( letters ) lettered.push( letters );

		}

	}

	hide() {

		if ( ! this.handles ) return;

		for ( const handle of this.handles ) this.pieces.release( handle );
		for ( const letters of this.lettered ?? [] ) this.signs.release( letters );
		this.handles = null;
		this.lettered = null;

	}

}
