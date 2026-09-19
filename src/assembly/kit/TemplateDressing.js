import { fnv1a, pickInt } from '../hash.js';
import { lotBays } from './BayCount.js';
import { chooseFamily } from './FamilyChoice.js';
import { fittingFamilies, floorRange } from './Families.js';
import { slotKey } from './BlockTemplates.js';

/** Atlas publishes block and lot metres on a millimetre grid. */
const TOLERANCE = 0.001;

/**
 * What every lot of a block template wears.
 *
 * The template, not the parcel, picks the family and the floor count: a stable
 * hash of the world seed, the template id and the lot slot dresses each slot
 * once, so the city repeats a handful of tilings and two blocks of one template
 * read as the same block. The slot stands inside every one of its parcels'
 * envelopes, so it follows the skyline of the zone it belongs to and no tower
 * lot stands as a two-floor box. A family that suits every parcel of the slot
 * dresses all of them; when the slot's uses have none in common each parcel
 * picks its own, so a mixed block never puts a luxury facade on a mid street
 * and never puts a plain one on a rich street either.
 *
 * One variation per block instance keeps the repetition from reading as a copy:
 * a stable hash of the block id either moves one slot's floor count by one, or
 * merges two adjacent slots of equal depth into one rectangular building, so
 * that block stands one long building where its neighbours stand two.
 */
export class TemplateDressing {

	/** @param templates a BlockTemplates index of the same blueprint */
	constructor( atlas, templates ) {

		this.worldSeed = atlas.meta.seed;
		this.templates = templates;
		this.parcels = new Map( atlas.parcels.map( ( parcel ) => [ parcel.id, parcel ] ) );
		this.slots = new Map();
		/** parcelId -> what it builds, or what absorbed it */
		this.dressed = new Map();

		for ( const [ blockId, block ] of templates.blocks ) this.#dressBlock( blockId, block );

	}

	/**
	 * How this parcel is dressed:
	 * `{ family, floors, bays, lot }` for a building, `lot` being the ground it
	 * covers, which spans two lots when the block's variation merged them;
	 * `{ absorbedBy }` for the neighbour a merge took over; null when the parcel
	 * is not on a templated block and keeps the per-parcel choice.
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
	 * One slot's family and floors. The floor count stands inside every one of
	 * the slot's envelopes; the family has to suit every parcel standing there,
	 * and is null when they have none in common, which sends each parcel to its
	 * own choice.
	 */
	#choose( key, width, depth, range, uses ) {

		const bays = lotBays( width, depth );

		if ( ! bays ) return null;

		const floors = pickInt( `${this.worldSeed}:kit-floors:${key}`, range.low, range.high );
		const fitting = uses.length
			? uses.map( ( parcel ) => fittingFamilies( bays, floors, parcel ) )
				.reduce( ( kept, fits ) => kept.filter( ( id ) => fits.includes( id ) ) )
			: [];

		return { family: chooseFamily( fitting, this.worldSeed, key ), bays, floors, range };

	}

	#parcelsIn( key ) {

		const [ templateId, index ] = key.split( '#' );

		return this.templates.parcelsIn( templateId, Number( index ) )
			.map( ( id ) => this.parcels.get( id ) ).filter( Boolean );

	}

	#dressBlock( blockId, { templateId, corner, slots } ) {

		const template = this.templates.templates.get( templateId );
		const options = this.#variations( templateId, template, slots );
		const chosen = options.length
			? options[ fnv1a( `${this.worldSeed}:kit-variation:${blockId}` ) % options.length ]
			: null;

		for ( const [ index, parcelId ] of slots ) {

			const choice = this.slot( templateId, index );

			if ( ! choice ) continue;

			this.dressed.set( parcelId, {
				family: choice.family,
				bays: choice.bays,
				floors: chosen?.kind === 'floors' && chosen.slot === index ? chosen.floors : choice.floors,
				lot: ringOf( corner, template.lots[ index ] )
			} );

		}

		if ( chosen?.kind !== 'merge' ) return;

		const host = slots.get( chosen.slots[ 0 ] );

		this.dressed.set( host, {
			family: chosen.family,
			bays: chosen.bays,
			floors: chosen.floors,
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
	#variations( templateId, template, slots ) {

		const present = [ ...slots.keys() ].sort( ( a, b ) => a - b );
		const merges = [];

		for ( const first of present ) {

			for ( const second of present ) {

				if ( second <= first ) continue;

				const lot = joined( template.lots[ first ], template.lots[ second ] );
				// A merge is this block's own building over its own two lots, so it
				// stands inside both of their envelopes or it is not an option.
				const covered = [ first, second ].map( ( index ) => this.parcels.get( slots.get( index ) ) ).filter( Boolean );
				const range = floorRange( covered );
				const merged = lot && range.fits && this.#choose( `${slotKey( templateId, first )}+${second}`,
					lot.width, lot.depth, range, use( covered ) );

				if ( merged ) merges.push( { kind: 'merge', slots: [ first, second ], lot, ...merged } );

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
