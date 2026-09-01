import { pointInRing, ringBounds } from '../ground/Polygons.js';
import { SegmentIndex } from './SegmentIndex.js';

/** Nothing stands in the swing of a door. */
const DOOR_CLEAR = 3.5;
/** Nothing narrows a walking line: this is measured from the line itself. */
const WALK_CLEAR = 1.1;
/** Two piles this close would read as one heap, so the second one is dropped. */
const PILE_GAP = 2.8;

/**
 * The one question placement asks: may something of this size stand here? No,
 * if it is inside a building, in front of a street door, on a line people walk,
 * or on top of something already standing. Answering yes claims the spot, so
 * the pass never puts two piles in the same place.
 */
export class Clearance {

	/**
	 * @param atlas CityBlueprint per ../../../../atlas/CONTRACT.md
	 * @param walk `networks.walk` per ../../../../connections/CONTRACT.md
	 */
	constructor( atlas, walk ) {

		this.parcels = atlas.parcels.map( ( parcel ) => ( {
			footprint: parcel.footprint,
			bounds: ringBounds( [ parcel.footprint ] ),
			door: parcel.access.point
		} ) );

		this.lines = new SegmentIndex();

		for ( const edge of walk?.edges ?? [] ) this.lines.addPath( edge.path, edge.id );

		this.claimed = new Map();

	}

	/** @param radius how far the thing standing here reaches from its centre. */
	claim( x, z, radius ) {

		if ( this.#blocked( x, z, radius ) ) return false;

		const key = cell( x, z );

		if ( ! this.claimed.has( key ) ) this.claimed.set( key, [] );

		this.claimed.get( key ).push( [ x, z ] );

		return true;

	}

	#blocked( x, z, radius ) {

		for ( const { footprint, bounds, door } of this.parcels ) {

			if ( Math.hypot( x - door[ 0 ], z - door[ 1 ] ) < DOOR_CLEAR + radius ) return true;

			const inside = x >= bounds.min[ 0 ] && x <= bounds.max[ 0 ]
				&& z >= bounds.min[ 1 ] && z <= bounds.max[ 1 ];

			if ( inside && pointInRing( x, z, footprint ) ) return true;

		}

		if ( this.lines.nearest( x, z, WALK_CLEAR + radius ) ) return true;

		const cx = Math.floor( x / PILE_GAP );
		const cz = Math.floor( z / PILE_GAP );

		for ( let dx = - 1; dx <= 1; dx ++ ) {

			for ( let dz = - 1; dz <= 1; dz ++ ) {

				for ( const [ ox, oz ] of this.claimed.get( `${cx + dx}:${cz + dz}` ) ?? [] ) {

					if ( Math.hypot( ox - x, oz - z ) < PILE_GAP ) return true;

				}

			}

		}

		return false;

	}

}

export const CLEARANCE = { door: DOOR_CLEAR, walk: WALK_CLEAR, pile: PILE_GAP };

function cell( x, z ) {

	return `${Math.floor( x / PILE_GAP )}:${Math.floor( z / PILE_GAP )}`;

}
