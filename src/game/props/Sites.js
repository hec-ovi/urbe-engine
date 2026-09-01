import { samplePath } from '../city/StreetLamps.js';
import { signedArea } from '../ground/Polygons.js';
import { SegmentIndex } from './SegmentIndex.js';

const ALLEY_STEP = 6.5;
/** How far a pile's centre stands off the wall it leans on. */
const STANDOFF = 0.55;
/** Two facades closer than this face each other across a service gap. */
const GAP_MAX = 7;
const GAP_STEP = 5;
/** A service corner is at the far end of a parcel from its own street door. */
const CORNER_FROM_DOOR = 14;
const CORNER_OUT = 0.8;

/**
 * Where a city puts the things nobody wants seen: down the alleys, in the gaps
 * between two buildings, and around the back corners of a block, away from the
 * door its street access uses. Every site is a point against a wall with the
 * direction that wall faces, which is what lets a pile lean the right way.
 *
 * This pass is geometry only. Nothing here decides what stands at a site or
 * whether anything does, so the same atlas always offers the same sites in the
 * same order.
 */
export class Sites {

	/** @param atlas CityBlueprint per ../../../../atlas/CONTRACT.md */
	constructor( atlas ) {

		this.atlas = atlas;
		this.facades = new SegmentIndex();

		for ( const parcel of atlas.parcels ) this.facades.addRing( parcel.footprint, parcel.id );

	}

	/** @returns [{ x, z, nx, nz, kind }], nx/nz pointing away from the wall. */
	all() {

		return [ ...this.#alleys(), ...this.#gaps(), ...this.#corners() ];

	}

	/** Down each alley wall, alternating sides so one side never fills up. */
	#alleys() {

		const sites = [];

		for ( const edge of this.atlas.streets.edges ) {

			if ( edge.class !== 'alley' ) continue;

			samplePath( edge.path, ALLEY_STEP ).forEach( ( { point, normal }, i ) => {

				const side = i % 2 ? - 1 : 1;
				const half = edge.width / 2 + ( side > 0 ? edge.sidewalk.left : edge.sidewalk.right );
				const reach = Math.max( 0, half - STANDOFF );

				sites.push( {
					x: point.x + normal.x * side * reach,
					z: point.z + normal.z * side * reach,
					nx: - normal.x * side,
					nz: - normal.z * side,
					kind: 'alley'
				} );

			} );

		}

		return sites;

	}

	/** Along any facade with another building's wall close in front of it. */
	#gaps() {

		const sites = [];

		for ( const parcel of this.atlas.parcels ) {

			for ( const { x, z, nx, nz } of alongFootprint( parcel.footprint, GAP_STEP ) ) {

				const px = x + nx * STANDOFF;
				const pz = z + nz * STANDOFF;
				const facing = this.facades.nearest( px, pz, GAP_MAX, ( id ) => id !== parcel.id );

				if ( facing ) sites.push( { x: px, z: pz, nx, nz, kind: 'gap' } );

			}

		}

		return sites;

	}

	/** The corners of each block, the ones its own street door cannot see. */
	#corners() {

		const sites = [];

		for ( const parcel of this.atlas.parcels ) {

			const [ dx, dz ] = parcel.access.point;

			for ( const { x, z, nx, nz } of footprintCorners( parcel.footprint ) ) {

				if ( Math.hypot( x - dx, z - dz ) < CORNER_FROM_DOOR ) continue;

				sites.push( { x: x + nx * CORNER_OUT, z: z + nz * CORNER_OUT, nx, nz, kind: 'corner' } );

			}

		}

		return sites;

	}

}

/** Points every `step` metres around a footprint, with the wall's outward normal. */
function alongFootprint( ring, step ) {

	const sign = signedArea( ring ) > 0 ? 1 : - 1;
	const out = [];

	for ( let i = 0; i < ring.length; i ++ ) {

		const [ ax, az ] = ring[ i ];
		const [ bx, bz ] = ring[ ( i + 1 ) % ring.length ];
		const dx = bx - ax;
		const dz = bz - az;
		const length = Math.hypot( dx, dz );

		if ( length < step ) continue;

		const nx = ( dz / length ) * sign;
		const nz = ( - dx / length ) * sign;

		for ( let d = step / 2; d < length; d += step ) {

			out.push( { x: ax + ( dx / length ) * d, z: az + ( dz / length ) * d, nx, nz } );

		}

	}

	return out;

}

/** Each footprint vertex with the direction the corner itself faces. */
function footprintCorners( ring ) {

	const sign = signedArea( ring ) > 0 ? 1 : - 1;
	const normals = ring.map( ( a, i ) => {

		const b = ring[ ( i + 1 ) % ring.length ];
		const dx = b[ 0 ] - a[ 0 ];
		const dz = b[ 1 ] - a[ 1 ];
		const length = Math.hypot( dx, dz ) || 1;

		return [ ( dz / length ) * sign, ( - dx / length ) * sign ];

	} );

	const out = [];

	for ( let i = 0; i < ring.length; i ++ ) {

		const before = normals[ ( i - 1 + ring.length ) % ring.length ];
		const after = normals[ i ];
		const nx = before[ 0 ] + after[ 0 ];
		const nz = before[ 1 ] + after[ 1 ];
		const length = Math.hypot( nx, nz );

		// A straight-through vertex has no corner to stand in; the two normals
		// cancel and there is nothing to face.
		if ( length < 0.4 ) continue;

		out.push( { x: ring[ i ][ 0 ], z: ring[ i ][ 1 ], nx: nx / length, nz: nz / length } );

	}

	return out;

}
