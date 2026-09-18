import { fnv1a, pickInt } from '../hash.js';
import { lotBays } from './BayCount.js';
import { chooseFamily } from './FamilyChoice.js';
import { MIN_FLOORS, fittingFamilies } from './Families.js';
import { slotKey } from './BlockTemplates.js';

/** Atlas publishes block and lot metres on a millimetre grid. */
const TOLERANCE = 0.001;
/** What a storey costs in height, which is what caps a slot's floor count. */
const PITCH = 4.5;

/**
 * What every lot of a block template wears.
 *
 * The template, not the parcel, picks the family and the floor count: a stable
 * hash of the world seed, the template id and the lot slot dresses each slot
 * once, so the city repeats a handful of tilings and two blocks of one template
 * read as the same block. The slot's floor ceiling is the median of the floor
 * counts its parcels' own envelopes allow, so a slot follows the skyline of the
 * zone it belongs to without one clipped parcel flattening every instance. A
 * family has to suit every parcel of the slot, so the slot's own uses decide it.
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
		const choice = this.#choose( key, lot.width, lot.depth, this.#ceiling( key ), this.#use( key ) );

		this.slots.set( key, choice );

		return choice;

	}

	/**
	 * One slot's family and floors. The family has to suit every parcel standing
	 * in the slot, so a mixed block never puts a luxury facade on a mid street.
	 */
	#choose( key, width, depth, ceiling, use ) {

		const bays = lotBays( width, depth );

		if ( ! bays ) return null;

		const max = Math.max( MIN_FLOORS, ceiling );
		const floors = pickInt( `${this.worldSeed}:kit-floors:${key}`, MIN_FLOORS, max );
		const fitting = use.length
			? use.map( ( parcel ) => fittingFamilies( bays, floors, parcel ) )
				.reduce( ( kept, fits ) => kept.filter( ( id ) => fits.includes( id ) ) )
			: [];

		return { family: chooseFamily( fitting, this.worldSeed, key ), bays, floors, ceiling: max };

	}

	/**
	 * How tall this slot stands: the median of the floor counts the envelopes of
	 * its own parcels allow, never below two.
	 */
	#ceiling( key ) {

		const allowed = this.#parcelsIn( key )
			.map( ( parcel ) => Math.min( parcel.envelope.maxFloors, Math.floor( parcel.envelope.maxHeight / PITCH ) ) )
			.sort( ( a, b ) => a - b );

		return Math.max( MIN_FLOORS, allowed[ Math.floor( ( allowed.length - 1 ) / 2 ) ] ?? MIN_FLOORS );

	}

	/** What the parcels of one slot are used for, which is what a family accepts. */
	#use( key ) {

		return this.#parcelsIn( key ).map( ( parcel ) => ( { type: parcel.type, tier: parcel.tier } ) );

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

		if ( floors < MIN_FLOORS ) return false;
		if ( ! choice.family ) return true;

		return this.#use( key ).every( ( parcel ) => fittingFamilies( choice.bays, floors, parcel ).includes( choice.family ) );

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
				const merged = lot && this.#choose( `${slotKey( templateId, first )}+${second}`, lot.width, lot.depth,
					this.slot( templateId, first )?.ceiling ?? MIN_FLOORS,
					[ ...this.#use( slotKey( templateId, first ) ), ...this.#use( slotKey( templateId, second ) ) ] );

				if ( merged ) merges.push( { kind: 'merge', slots: [ first, second ], lot, ...merged } );

			}

		}

		const moves = present.flatMap( ( index ) => {

			const key = slotKey( templateId, index );
			const choice = this.slot( templateId, index );

			if ( ! choice || choice.ceiling <= MIN_FLOORS ) return [];

			const floors = choice.floors < choice.ceiling ? choice.floors + 1 : choice.floors - 1;

			return this.#holds( choice, floors, key ) ? [ { kind: 'floors', slot: index, floors } ] : [];

		} );

		return [ ...merges, ...moves ];

	}

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
