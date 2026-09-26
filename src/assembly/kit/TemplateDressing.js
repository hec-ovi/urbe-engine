import { fnv1a, pickInt } from '../hash.js';
import { lotBays } from './BayCount.js';
import { sharedUse } from './DressingClass.js';
import { chooseFamily } from './FamilyChoice.js';
import { fittingFamilies, floorRange } from './Families.js';
import { slotKey } from './BlockTemplates.js';
import { entranceFace, facing, streetPaths } from './Entrance.js';

/** Atlas publishes block and lot metres on a millimetre grid. */
const TOLERANCE = 0.001;

/**
 * What every lot of a block template wears.
 *
 * The template, not the parcel, picks the whole building: a stable hash of the
 * world seed, the template id and the lot slot gives each slot one family, one
 * floor count and one class to be drawn for, so the city repeats a handful of
 * tilings and every block of one template stands the same buildings. The slot
 * stands inside every one of its parcels' envelopes, so it follows the skyline
 * of the zone it belongs to and no tower lot stands as a two-floor box. Its
 * family is the one the most of its lots accept and its class the one the most
 * of the lots standing that family carry, so a slot is one building; a lot that
 * family does not fit takes one of its own, which is the only exception.
 *
 * One variation per block instance keeps the repetition from reading as a copy:
 * a block either moves one slot's floor count by one, or merges two adjacent
 * slots of equal depth into one rectangular building, so that block stands one
 * long building where its neighbours stand two. Every other slot of the block
 * stands the template's building unchanged. The variations of a template are
 * dealt across its blocks: a stable hash of the block id picks among the ones
 * its template's other blocks have taken the least, so two blocks of one
 * template stand the same variation only once every one is in use, and the
 * template's own building is what most blocks stand on every slot.
 */
export class TemplateDressing {

	/** @param templates a BlockTemplates index of the same blueprint */
	constructor( atlas, templates ) {

		this.worldSeed = atlas.meta.seed;
		this.templates = templates;
		this.parcels = new Map( atlas.parcels.map( ( parcel ) => [ parcel.id, parcel ] ) );
		this.streets = streetPaths( atlas );
		this.slots = new Map();
		/** `${templateId}#${first}+${second}` -> the building a merge of those slots stands */
		this.merges = new Map();
		/** templateId -> variation id -> how many of its blocks took it */
		this.taken = new Map();
		/** parcelId -> what it builds, or what absorbed it */
		this.dressed = new Map();

		for ( const [ blockId, block ] of templates.blocks ) this.#dressBlock( blockId, block );

	}

	/**
	 * How this parcel is dressed:
	 * `{ family, floors, use, lot }` for a building, `use` being the class
	 * it is drawn for and `lot` the ground it covers, which spans two lots when
	 * the block's variation merged them; `{ absorbedBy }` for the neighbour a
	 * merge took over; null when the parcel is not on a templated block and
	 * keeps the per-parcel choice.
	 */
	of( parcelId ) {

		return this.dressed.get( parcelId ) ?? null;

	}

	/** One slot's family, floors and class, shared by every block of the template. */
	slot( templateId, index ) {

		const key = slotKey( templateId, index );
		const held = this.slots.get( key );

		if ( held !== undefined ) return held;

		const lot = this.templates.templates.get( templateId ).lots[ index ];
		const parcels = this.#parcelsIn( key );
		const choice = this.#choose( key, lot, floorRange( parcels ), parcels );

		this.slots.set( key, choice );

		return choice;

	}

	/**
	 * The long building two slots of a template stand when a block merges them,
	 * decided over every parcel standing in either slot, so every block that
	 * takes that merge stands the same building.
	 * @returns the merge option, or null when the joined lot is no building
	 */
	merge( templateId, first, second ) {

		const key = `${slotKey( templateId, first )}+${second}`;
		const held = this.merges.get( key );

		if ( held !== undefined ) return held;

		const template = this.templates.templates.get( templateId );
		const lot = joined( template.lots[ first ], template.lots[ second ] );
		const parcels = [ first, second ].flatMap( ( index ) => this.#parcelsIn( slotKey( templateId, index ) ) );
		const choice = lot && parcels.length ? this.#choose( key, lot, floorRange( parcels ), parcels ) : null;
		const option = choice ? { kind: 'merge', slots: [ first, second ], ...choice } : null;

		this.merges.set( key, option );

		return option;

	}

	/**
	 * One slot's building: its family, its floor count and the class it is drawn
	 * for. The floor count stands inside every one of the slot's envelopes; the
	 * family is the one the most of the slot's lots accept, each read the way
	 * its own entrance turns the building, and is null only when none of them
	 * accepts any; the class is the one the most of the lots that stand that
	 * family carry, since the rest take a building of their own.
	 * @param lot the template lot, `{ offset, width, depth }`, that every block
	 * of the template stands this building on
	 */
	#choose( key, lot, range, parcels ) {

		if ( ! lotBays( lot.width, lot.depth ) ) return null;

		const floors = pickInt( `${this.worldSeed}:kit-floors:${key}`, range.low, range.high );
		const fits = parcels.map( ( parcel ) => this.#fits( lot, floors, parcel ) );
		const family = chooseFamily( widest( fits ), this.worldSeed, key );
		const standing = parcels.filter( ( parcel, at ) => family === null || fits[ at ].includes( family ) );

		return { family, floors, range, lot, use: sharedUse( standing.map( useOf ) ) };

	}

	/**
	 * The families one parcel accepts on a template lot of its block: the lot as
	 * the building sees it from the face the parcel's entrance takes.
	 */
	#fits( lot, floors, parcel ) {

		const { blockId } = this.templates.slotOf.get( parcel.id );
		const face = entranceFace( ringOf( this.templates.blocks.get( blockId ).corner, lot ), parcel.access, this.streets );

		return fittingFamilies( facing( lotBays( lot.width, lot.depth ), face ), floors, parcel );

	}

	#parcelsIn( key ) {

		const [ templateId, index ] = key.split( '#' );

		return this.templates.parcelsIn( templateId, Number( index ) )
			.map( ( id ) => this.parcels.get( id ) ).filter( Boolean );

	}

	#dressBlock( blockId, { templateId, corner, slots } ) {

		const template = this.templates.templates.get( templateId );
		const chosen = this.#deal( templateId, blockId, this.#variations( templateId, slots ) );

		for ( const [ index, parcelId ] of slots ) {

			const choice = this.slot( templateId, index );

			if ( ! choice ) continue;

			this.dressed.set( parcelId, {
				family: choice.family,
				// Every slot but the one the variation picked stands the template's
				// own building, so a block reads as a copy of its template plus one
				// deliberate difference.
				floors: chosen?.kind === 'floors' && chosen.slot === index ? chosen.floors : choice.floors,
				use: choice.use,
				lot: ringOf( corner, template.lots[ index ] )
			} );

		}

		if ( chosen?.kind !== 'merge' ) return;

		const host = slots.get( chosen.slots[ 0 ] );

		this.dressed.set( host, {
			family: chosen.family,
			floors: chosen.floors,
			use: chosen.use,
			lot: ringOf( corner, chosen.lot ),
			absorbs: slots.get( chosen.slots[ 1 ] )
		} );
		this.dressed.set( slots.get( chosen.slots[ 1 ] ), { absorbedBy: host } );

	}

	/**
	 * The variation this block takes: the one its hash picks among those its
	 * template's other blocks have taken the least, so every variation is in use
	 * before any block repeats one and no two neighbours read as the same copy.
	 * @returns the chosen option, or null when the block has none
	 */
	#deal( templateId, blockId, options ) {

		if ( ! options.length ) return null;

		const counts = this.taken.get( templateId ) ?? new Map();
		const uses = ( option ) => counts.get( option.id ) ?? 0;
		const fewest = Math.min( ...options.map( uses ) );
		const rarest = options.filter( ( option ) => uses( option ) === fewest );
		const chosen = rarest[ fnv1a( `${this.worldSeed}:kit-variation:${blockId}` ) % rarest.length ];

		counts.set( chosen.id, fewest + 1 );
		this.taken.set( templateId, counts );

		return chosen;

	}

	/**
	 * Whether one lot stands the slot's design at a floor count: inside the
	 * slot's band, wearing the slot's family where it has one. A move is offered
	 * only where the block's own lot stands the design before and after it, so a
	 * step is the template's building one floor over and never a design of its
	 * own.
	 */
	#stands( choice, floors, parcel ) {

		if ( floors < choice.range.low || floors > choice.range.high ) return false;
		if ( ! choice.family ) return true;

		return this.#fits( choice.lot, floors, parcel ).includes( choice.family );

	}

	/**
	 * Everything this block could do differently, in one stable order: the lot
	 * pairs it can merge, then the slots whose floor count it can move. Each
	 * carries the id it is dealt under, which names the same variation on every
	 * block of the template.
	 */
	#variations( templateId, slots ) {

		const present = [ ...slots.keys() ].sort( ( a, b ) => a - b );
		const merges = [];

		for ( const first of present ) {

			for ( const second of present ) {

				if ( second <= first ) continue;

				// A merge is offered only for two lots one building suits, which is
				// this block's own pair; the building it stands is the template's,
				// so every block that merges the same two slots stands that one.
				const covered = [ first, second ].map( ( index ) => this.parcels.get( slots.get( index ) ) ).filter( Boolean );
				const merged = floorRange( covered ).fits && this.merge( templateId, first, second );

				if ( merged ) merges.push( { id: `merge:${first}+${second}`, ...merged } );

			}

		}

		const moves = present.flatMap( ( index ) => {

			const choice = this.slot( templateId, index );
			const parcel = this.parcels.get( slots.get( index ) );

			if ( ! choice || ! parcel || choice.range.high <= choice.range.low ) return [];

			const floors = choice.floors < choice.range.high ? choice.floors + 1 : choice.floors - 1;
			const stands = this.#stands( choice, choice.floors, parcel ) && this.#stands( choice, floors, parcel );

			return stands ? [ { id: `floors:${index}`, kind: 'floors', slot: index, floors } ] : [];

		} );

		return [ ...merges, ...moves ];

	}

}

/** What a parcel is used for, which is what a family accepts and a plan is drawn for. */
function useOf( { type, tier } ) {

	return { type, tier };

}

/**
 * The families the most of a slot's lots accept, which is what that slot
 * stands. Empty when no lot accepts any, which is the plain building.
 * @param fits the fitting families of each lot, in the slot's order
 */
function widest( fits ) {

	const counted = new Map();

	for ( const families of fits ) for ( const id of families ) counted.set( id, ( counted.get( id ) ?? 0 ) + 1 );

	const most = Math.max( 0, ...counted.values() );

	return [ ...counted ].filter( ( [ , count ] ) => count === most ).map( ( [ id ] ) => id );

}

/** The rectangle two adjacent lots of equal depth make, or null when they make none. */
function joined( first, second ) {

	if ( ! first || ! second ) return null;

	const [ a, b ] = first.offset[ 0 ] + first.offset[ 1 ] <= second.offset[ 0 ] + second.offset[ 1 ]
		? [ first, second ] : [ second, first ];

	if ( near( a.offset[ 1 ], b.offset[ 1 ] ) && near( a.depth, b.depth ) && near( a.offset[ 0 ] + a.width, b.offset[ 0 ] ) ) {

		return { offset: [ ...a.offset ], width: a.width + b.width, depth: a.depth };

	}
	if ( near( a.offset[ 0 ], b.offset[ 0 ] ) && near( a.width, b.width ) && near( a.offset[ 1 ] + a.depth, b.offset[ 1 ] ) ) {

		return { offset: [ ...a.offset ], width: a.width, depth: a.depth + b.depth };

	}

	return null;

}

/** A template lot as a world ring, wound the way Exterior reads a footprint. */
function ringOf( corner, lot ) {

	const x = corner[ 0 ] + lot.offset[ 0 ];
	const z = corner[ 1 ] + lot.offset[ 1 ];

	return [ [ x, z ], [ x + lot.width, z ], [ x + lot.width, z + lot.depth ], [ x, z + lot.depth ] ];

}

function near( a, b ) {

	return Math.abs( a - b ) <= TOLERANCE;

}
