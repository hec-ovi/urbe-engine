import { StreetInstanceTable } from './StreetInstanceTable.js';

/**
 * Which surface reads which placement value, and the table behind each one.
 *
 * Every surface reads the tint and the wear its placements carry. The two that
 * cost more are asked for by the bundle itself: the surfaces of the pieces a
 * scan placement stands on sample the scan atlas, and a display face on a piece
 * a text placement stands on letters as many glyphs as the longest of them.
 */
export class StreetInstances {

	/**
	 * @param kit the manifest's `kit`
	 * @param placements the manifest's placement table
	 * @param binding the native material snapshot, for each surface's effect
	 */
	constructor( kit, placements, binding ) {

		const pieces = new Map( kit.pieces.map( piece => [ piece.id, piece ] ) );
		const scan = new Set(), glyphs = new Map();

		for ( const placement of placements ) {

			const surfaces = pieces.get( placement.piece )?.surfaces ?? [];
			if ( placement.scan ) for ( const id of surfaces ) scan.add( id );
			if ( placement.text?.length ) {

				for ( const id of surfaces ) {

					if ( binding.surfaces[ id ]?.effect === 'display' ) glyphs.set( id, Math.max( glyphs.get( id ) ?? 0, placement.text.length ) );

				}

			}

		}
		this.scanAtlas = kit.scanAtlas;
		this.tables = new Map( [ ...new Set( kit.pieces.flatMap( piece => piece.surfaces ) ) ]
			.map( id => [ id, new StreetInstanceTable( { scan: scan.has( id ), glyphs: glyphs.get( id ) ?? 0 } ) ] ) );
		this.byBatch = new Map();

	}

	/** What the factory needs to build one surface's material. */
	options( surfaceId ) {

		const table = this.tables.get( surfaceId );

		return { instances: table.ports, ...( table.scan ? { scanCells: this.scanAtlas } : {} ) };

	}

	/** Takes the batches the kit built, one per surface. */
	bind( batches ) {

		for ( const [ surfaceId, batch ] of batches ) {

			const table = this.tables.get( surfaceId );
			table.bind( batch );
			this.byBatch.set( batch, table );

		}

	}

	/** Every table back onto its batch's current tables, after a reservation replaced them. */
	follow() {

		for ( const table of this.tables.values() ) table.follow();

	}

	/** The values of one admitted copy, at the slot each of its batches gave it. */
	write( handle, placement ) {

		for ( const [ index, { batch } ] of handle.parts.entries() ) this.byBatch.get( batch ).write( handle.instances[ index ], placement );

	}

	dispose() {

		for ( const table of this.tables.values() ) table.dispose();
		this.tables.clear();
		this.byBatch.clear();

	}

}
