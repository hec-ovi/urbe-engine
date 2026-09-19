import { fnv1a, pickInt } from '../hash.js';
import { lotBays } from './BayCount.js';
import { sharedUse } from './DressingClass.js';
import { chooseFamily } from './FamilyChoice.js';
import { fittingFamilies, floorRange } from './Families.js';
import { slotKey } from './BlockTemplates.js';

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
 * family suits every parcel standing there, so a mixed block never puts a
 * luxury facade on a mid street, and its class is the one the most of its lots
 * carry, so a slot is one building and not one per tier.
 *
 * One variation per block instance keeps the repetition from reading as a copy:
 * a stable hash of the block id either moves one slot's floor count by one, or
 * merges two adjacent slots of equal depth into one rectangular building, so
 * that block stands one long building where its neighbours stand two. Every
 * other slot of the block stands the template's building unchanged.
 */
export class TemplateDressing {

	/** @param templates a BlockTemplates index of the same blueprint */
	constructor( atlas, templates ) {

		this.worldSeed = atlas.meta.seed;
		this.templates = templates;
		this.parcels = new Map( atlas.parcels.map( ( parcel ) => [ parcel.id, parcel ] ) );
		this.slots = new Map();
		/** `${templateId}#${first}+${second}` -> the building a merge of those slots stands */
		this.merges = new Map();
		/** parcelId -> what it builds, or what absorbed it */
		this.dressed = new Map();

		for ( const [ blockId, block ] of templates.blocks ) this.#dressBlock( blockId, block );

	}

	/**
	 * How this parcel is dressed:
	 * `{ family, floors, bays, use, lot }` for a building, `use` being the class
	 * it is drawn for and `lot` the ground it covers, which spans two lots when
	 * the block's variation merged them; `{ absorbedBy }` for the neighbour a
	 * merge took over; null when the parcel is not on a templated block and
	 * keeps the per-parcel choice.
	 */
	of( parcelId ) {

		return this.dressed.get( parcelId ) ?? null;

	}

	/** One slot's family, floors and bays, shared by every block of the template. */
	slot( templateId, index ) {

		const key = slotKey( templateId, index );
		const held = this.slots.get( key );

		if ( held !== undefined ) return held;

		const lot = this.templates.templates.get( templateId ).lots[ index ];
		const parcels = this.#parcelsIn( key );
		const choice = this.#choose( key, lot.width, lot.depth, floorRange( parcels ), use( parcels ) );

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
		const choice = lot && parcels.length
			? this.#choose( key, lot.width, lot.depth, floorRange( parcels ), use( parcels ) )
			: null;
		const option = choice ? { kind: 'merge', slots: [ first, second ], lot, ...choice } : null;

		this.merges.set( key, option );

		return option;

	}

	/**
	 * One slot's building: its family, its floor count and the class it is drawn
	 * for. The floor count stands inside every one of the slot's envelopes; the
	 * family has to suit every parcel standing there, and is null when they have
	 * none in common, which is the plain building; the class is the one the most
	 * of those parcels carry.
	 */
	#choose( key, width, depth, range, uses ) {

		const bays = lotBays( width, depth );

		if ( ! bays ) return null;

		const floors = pickInt( `${this.worldSeed}:kit-floors:${key}`, range.low, range.high );
		const fitting = uses.length
			? uses.map( ( parcel ) => fittingFamilies( bays, floors, parcel ) )
				.reduce( ( kept, fits ) => kept.filter( ( id ) => fits.includes( id ) ) )
			: [];

		return { family: chooseFamily( fitting, this.worldSeed, key ), bays, floors, range, use: sharedUse( uses ) };

	}

	#parcelsIn( key ) {

		const [ templateId, index ] = key.split( '#' );

		return this.templates.parcelsIn( templateId, Number( index ) )
			.map( ( id ) => this.parcels.get( id ) ).filter( Boolean );

	}

	#dressBlock( blockId, { templateId, corner, slots } ) {

		const template = this.templates.templates.get( templateId );
		const options = this.#variations( templateId, slots );
		const chosen = options.length
			? options[ fnv1a( `${this.worldSeed}:kit-variation:${blockId}` ) % options.length ]
			: null;

		for ( const [ index, parcelId ] of slots ) {

			const choice = this.slot( templateId, index );

			if ( ! choice ) continue;

			this.dressed.set( parcelId, {
				family: choice.family,
				bays: choice.bays,
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
			bays: chosen.bays,
			floors: chosen.floors,
			use: chosen.use,
			lot: ringOf( corner, chosen.lot ),
			absorbs: slots.get( chosen.slots[ 1 ] )
		} );
		this.dressed.set( slots.get( chosen.slots[ 1 ] ), { absorbedBy: host } );

	}

	/**
	 * Whether the slot still wears the family it was dressed with once the block
	 * variation has moved its floor count, so a move never leaves a family on a
	 * building it no longer fits.
	 */
	#holds( choice, floors, key ) {

		if ( floors < choice.range.low || floors > choice.range.high ) return false;
		if ( ! choice.family ) return true;

		return use( this.#parcelsIn( key ) )
			.every( ( parcel ) => fittingFamilies( choice.bays, floors, parcel ).includes( choice.family ) );

	}

	/**
	 * Everything this block could do differently, in one stable order: the
	 * mergeable lot pairs, then the slots whose floor count can move.
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

				if ( merged ) merges.push( merged );

			}

		}

		const moves = present.flatMap( ( index ) => {

			const key = slotKey( templateId, index );
			const choice = this.slot( templateId, index );

			if ( ! choice || choice.range.high <= choice.range.low ) return [];

			const floors = choice.floors < choice.range.high ? choice.floors + 1 : choice.floors - 1;

			return this.#holds( choice, floors, key ) ? [ { kind: 'floors', slot: index, floors } ] : [];

		} );

		return [ ...merges, ...moves ];

	}

}

/** What a slot's parcels are used for, which is what a family accepts. */
function use( parcels ) {

	return parcels.map( ( parcel ) => ( { type: parcel.type, tier: parcel.tier } ) );

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
