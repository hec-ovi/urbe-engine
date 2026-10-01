import { StreetInstanceTable } from './StreetInstanceTable.js';
import { drawnSurfaces } from './StreetRoutes.js';
import { placementId } from '../materials/StreetVariants.js';

/**
 * Which surface reads which placement value, and the table behind each one.
 *
 * Every surface reads the tint and the wear its placements carry. The two that
 * cost more are asked for by the bundle itself: the surfaces of the pieces a
 * scan placement stands on sample the scan atlas, and a display face on a piece
 * a text placement stands on letters as many glyphs as the longest of them. A
 * surface that picks its variant per panel carries each copy's hash prefix.
 */
export class StreetInstances {

	/**
	 * @param kit the manifest's `kit`
	 * @param placements the manifest's placement table
	 * @param binding the native material snapshot, for each surface's effect
	 * @param variants the whole-bundle variants ([StreetVariants](../materials/StreetVariants.js)), or null
	 */
	constructor( kit, placements, binding, variants = null ) {

		const pieces = new Map( kit.pieces.map( piece => [ piece.id, piece ] ) );
		const scan = new Set(), glyphs = new Map();

		for ( const placement of placements ) {

			const piece = pieces.get( placement.piece );
			const surfaces = piece ? drawnSurfaces( piece, binding ) : [];
			if ( placement.scan ) for ( const id of surfaces ) scan.add( id );
			if ( placement.text?.length ) {

				for ( const id of surfaces ) {

					if ( binding.surfaces[ id ]?.effect === 'display' ) glyphs.set( id, Math.max( glyphs.get( id ) ?? 0, placement.text.length ) );

				}

			}

		}
		this.scanAtlas = kit.scanAtlas;
		// A batch of world-sampled copies (`<surface>@world`) picks per world cell and needs no prefix.
		// A copy hashes its prefix once, however often its cell streams back in.
		const prefix = ( id ) => {

			if ( variants?.of( id )?.unit !== 'panel' ) return null;
			const known = new WeakMap();
			return ( placement ) => {

				if ( ! known.has( placement ) ) known.set( placement, variants.seed( id, placementId( placement ) ) );
				return known.get( placement );

			};

		};
		this.tables = new Map( [ ...new Set( kit.pieces.flatMap( piece => drawnSurfaces( piece, binding ) ) ) ]
			.map( id => [ id, new StreetInstanceTable( { scan: scan.has( id ), glyphs: glyphs.get( id ) ?? 0, variant: prefix( id ) } ) ] ) );
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
