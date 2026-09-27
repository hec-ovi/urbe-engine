import { SIDEWALK_HEIGHT } from '../ground/GroundBuilder.js';
import { pointInRing } from '../ground/Polygons.js';

/** Side of one square cell of the cover index, in metres. */
const CELL = 16;
/** The street surfaces people walk on, and the level each stands at when Atlas publishes none. */
const LEVELS = { roadway: 0, gutter: 0, curb: SIDEWALK_HEIGHT, sidewalk: SIDEWALK_HEIGHT, block: SIDEWALK_HEIGHT, open: SIDEWALK_HEIGHT };

/**
 * What people stand on outdoors: the top of the Atlas ground cover under a
 * point (carriageway, gutter, kerb, pavement, block paving or open ground),
 * which both the native streets and the retained ground draw. Connections
 * walk edges run at grade, so a body on the street is raised onto the cover
 * it stands on rather than walking with its feet in the paving.
 */
export class WalkSurface {

	/** @param covers Atlas `volumetric.ground`: `{ surface, polygon, top? }` */
	constructor( covers = [] ) {

		this.cells = new Map();
		/** The pavement level: the highest published sidewalk top, else the retained ground's. */
		this.paving = SIDEWALK_HEIGHT;
		let paved = null;
		for ( const cover of covers ) {

			if ( ! ( cover.surface in LEVELS ) || ! ( cover.polygon?.length >= 3 ) ) continue;
			const top = Number.isFinite( cover.top ) ? cover.top : LEVELS[ cover.surface ];
			if ( cover.surface === 'sidewalk' ) paved = Math.max( paved ?? top, top );
			const entry = { polygon: cover.polygon, top, box: box( cover.polygon ) };
			for ( let cx = cell( entry.box.minX ); cx <= cell( entry.box.maxX ); cx ++ ) {

				for ( let cz = cell( entry.box.minZ ); cz <= cell( entry.box.maxZ ); cz ++ ) {

					const key = `${cx}:${cz}`;
					if ( ! this.cells.has( key ) ) this.cells.set( key, [] );
					this.cells.get( key ).push( entry );

				}

			}

		}
		if ( paved !== null ) this.paving = paved;

	}

	/** The top of the highest cover under (x, z), or null where no street cover lies. */
	height( x, z ) {

		let top = null;
		for ( const entry of this.cells.get( `${cell( x )}:${cell( z )}` ) ?? [] ) {

			const { box: b } = entry;
			if ( ( top !== null && entry.top <= top ) || x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ ) continue;
			if ( pointInRing( x, z, entry.polygon ) ) top = entry.top;

		}
		return top;

	}

}

function cell( value ) {

	return Math.floor( value / CELL );

}

function box( ring ) {

	const b = { minX: Infinity, maxX: - Infinity, minZ: Infinity, maxZ: - Infinity };
	for ( const [ x, z ] of ring ) {

		b.minX = Math.min( b.minX, x ); b.maxX = Math.max( b.maxX, x );
		b.minZ = Math.min( b.minZ, z ); b.maxZ = Math.max( b.maxZ, z );

	}
	return b;

}
