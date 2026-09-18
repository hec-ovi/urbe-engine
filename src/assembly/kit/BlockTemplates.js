import { lotRectangle } from './LotRectangle.js';

/** Atlas publishes block and lot metres on a millimetre grid. */
const TOLERANCE = 0.001;

/**
 * Which template slot each parcel sits in.
 *
 * Atlas tiles a block from `meta.blockTemplates`: an entry per block size and
 * zone, with the lots it cuts and each lot's offset from the block's minimum
 * corner. Two blocks of the same size and zone carry the same template, so the
 * city is a handful of tilings repeated. A parcel is matched to its slot by
 * that offset and the lot's own size, and a block without a template (water or
 * infrastructure cut it) has no slots at all.
 */
export class BlockTemplates {

	constructor( atlas ) {

		this.templates = new Map( ( atlas.meta.blockTemplates ?? [] ).map( ( template ) => [ template.id, template ] ) );
		/** parcelId -> { templateId, slot, blockId } */
		this.slotOf = new Map();
		/** `${templateId}#${slot}` -> parcelIds, in blueprint order */
		this.instances = new Map();
		/** blockId -> { templateId, corner, slots: Map<slot, parcelId> } */
		this.blocks = new Map();

		const parcels = new Map( atlas.parcels.map( ( parcel ) => [ parcel.id, parcel ] ) );

		for ( const block of atlas.blocks ?? [] ) {

			const template = this.templates.get( block.template );

			if ( ! template ) continue;

			const corner = minCorner( block.boundary );
			const slots = new Map();

			for ( const parcelId of block.parcelIds ) {

				const parcel = parcels.get( parcelId );
				const slot = parcel ? this.#slotAt( template, corner, parcel.lot ) : - 1;

				if ( slot < 0 ) continue;

				slots.set( slot, parcelId );
				this.slotOf.set( parcelId, { templateId: template.id, slot, blockId: block.id } );
				const key = slotKey( template.id, slot );
				const listed = this.instances.get( key );
				if ( listed ) listed.push( parcelId );
				else this.instances.set( key, [ parcelId ] );

			}

			if ( slots.size ) this.blocks.set( block.id, { templateId: template.id, corner, slots } );

		}

	}

	/** The parcels standing in one template slot, across every block of that template. */
	parcelsIn( templateId, slot ) {

		return this.instances.get( slotKey( templateId, slot ) ) ?? [];

	}

	#slotAt( template, corner, lot ) {

		if ( ! lotRectangle( lot ) ) return - 1;

		const at = minCorner( lot );
		const far = maxCorner( lot );

		return template.lots.findIndex( ( entry ) =>
			near( entry.offset[ 0 ], at[ 0 ] - corner[ 0 ] ) && near( entry.offset[ 1 ], at[ 1 ] - corner[ 1 ] )
			&& near( entry.width, far[ 0 ] - at[ 0 ] ) && near( entry.depth, far[ 1 ] - at[ 1 ] ) );

	}

}

/** `${templateId}#${slot}`, the key a slot's choice is hashed and cached under. */
export function slotKey( templateId, slot ) {

	return `${templateId}#${slot}`;

}

function minCorner( ring ) {

	return [ Math.min( ...ring.map( ( point ) => point[ 0 ] ) ), Math.min( ...ring.map( ( point ) => point[ 1 ] ) ) ];

}

function maxCorner( ring ) {

	return [ Math.max( ...ring.map( ( point ) => point[ 0 ] ) ), Math.max( ...ring.map( ( point ) => point[ 1 ] ) ) ];

}

function near( a, b ) {

	return Math.abs( a - b ) <= TOLERANCE;

}
