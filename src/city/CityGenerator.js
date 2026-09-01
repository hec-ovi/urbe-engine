import { Rng } from './Rng.js';
import { ARCHETYPES } from './archetypes.js';

const CELL = 26; // metres per building cell
const BLOCK = 6; // cells per block before a street
const STREET = 14; // extra street width between blocks
const JITTER = 3; // max in-cell offset

/**
 * Seeded placeholder city: N boxes on a street grid over flat ground.
 * Pure data, no rendering types. Same seed and count give an identical city.
 */
export class CityGenerator {

	constructor( seed ) {

		this.seed = seed;

	}

	/**
	 * @param {number} count buildings to place
	 * @returns {{ buildings: Array<{archetype:number, x:number, z:number, sx:number, sy:number, sz:number}>, halfExtent: number }}
	 *   archetype indexes ARCHETYPES; x/z is the footprint centre on the ground;
	 *   sx/sy/sz are width, height, depth in metres. halfExtent bounds the grid.
	 */
	generate( count ) {

		const rng = new Rng( this.seed );
		const weights = ARCHETYPES.map( ( a ) => a.weight );
		const side = Math.ceil( Math.sqrt( count ) );
		const span = ( i ) => i * CELL + Math.floor( i / BLOCK ) * STREET;
		const half = span( side ) / 2;

		const buildings = [];

		for ( let row = 0; row < side && buildings.length < count; row ++ ) {

			for ( let col = 0; col < side && buildings.length < count; col ++ ) {

				const archetype = rng.pickWeighted( weights );
				const def = ARCHETYPES[ archetype ];

				buildings.push( {
					archetype,
					x: span( col ) - half + CELL / 2 + rng.range( - JITTER, JITTER ),
					z: span( row ) - half + CELL / 2 + rng.range( - JITTER, JITTER ),
					sx: rng.range( def.footprint[ 0 ], def.footprint[ 1 ] ),
					sy: rng.range( def.height[ 0 ], def.height[ 1 ] ),
					sz: rng.range( def.footprint[ 0 ], def.footprint[ 1 ] )
				} );

			}

		}

		return { buildings, halfExtent: half + STREET };

	}

}
