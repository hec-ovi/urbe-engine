/**
 * A grid over 2D segments, so "what is near this point" stays a handful of
 * cells rather than every wall and every pavement line in the city. Segments
 * go into every cell their bounding box touches, which over-files a diagonal
 * one and can never miss it.
 */
export class SegmentIndex {

	constructor( cell = 8 ) {

		this.cell = cell;
		this.cells = new Map();

	}

	/** @param data carried through to whatever the query finds. */
	add( ax, az, bx, bz, data ) {

		if ( Math.hypot( bx - ax, bz - az ) < 1e-6 ) return;

		const segment = { ax, az, bx, bz, data };
		const x0 = Math.floor( Math.min( ax, bx ) / this.cell );
		const x1 = Math.floor( Math.max( ax, bx ) / this.cell );
		const z0 = Math.floor( Math.min( az, bz ) / this.cell );
		const z1 = Math.floor( Math.max( az, bz ) / this.cell );

		for ( let cx = x0; cx <= x1; cx ++ ) {

			for ( let cz = z0; cz <= z1; cz ++ ) {

				const key = `${cx}:${cz}`;

				if ( ! this.cells.has( key ) ) this.cells.set( key, [] );

				this.cells.get( key ).push( segment );

			}

		}

	}

	/** Every leg of an open polyline of [x, z] points. */
	addPath( path, data ) {

		for ( let i = 0; i < path.length - 1; i ++ ) {

			this.add( path[ i ][ 0 ], path[ i ][ 1 ], path[ i + 1 ][ 0 ], path[ i + 1 ][ 1 ], data );

		}

	}

	/** Every leg of a closed ring, the last vertex back to the first included. */
	addRing( ring, data ) {

		for ( let i = 0; i < ring.length; i ++ ) {

			const a = ring[ i ];
			const b = ring[ ( i + 1 ) % ring.length ];
			this.add( a[ 0 ], a[ 1 ], b[ 0 ], b[ 1 ], data );

		}

	}

	/**
	 * The closest segment within `radius`, as { distance, px, pz, data } at the
	 * point on it, or null.
	 * @param accept optional filter on a segment's data
	 */
	nearest( x, z, radius, accept ) {

		const cx = Math.floor( x / this.cell );
		const cz = Math.floor( z / this.cell );
		const span = Math.ceil( radius / this.cell );
		let best = null;

		for ( let dx = - span; dx <= span; dx ++ ) {

			for ( let dz = - span; dz <= span; dz ++ ) {

				for ( const segment of this.cells.get( `${cx + dx}:${cz + dz}` ) ?? [] ) {

					if ( accept && ! accept( segment.data ) ) continue;

					const hit = closestOnSegment( x, z, segment );

					if ( hit.distance < radius && ( ! best || hit.distance < best.distance ) ) {

						best = { ...hit, data: segment.data };

					}

				}

			}

		}

		return best;

	}

}

/** Distance from [x, z] to a segment, and the point on it that is that close. */
export function closestOnSegment( x, z, { ax, az, bx, bz } ) {

	const dx = bx - ax;
	const dz = bz - az;
	const t = Math.max( 0, Math.min( 1, ( ( x - ax ) * dx + ( z - az ) * dz ) / ( dx * dx + dz * dz ) ) );
	const px = ax + dx * t;
	const pz = az + dz * t;

	return { distance: Math.hypot( x - px, z - pz ), px, pz };

}
