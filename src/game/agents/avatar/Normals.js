/** Triangles between yields: a millisecond or two of the loop below. */
const BATCH = 4096;

/**
 * A surface's vertex normals, the values three's
 * `BufferGeometry.computeVertexNormals` and `normalizeNormals` give, to the
 * bit, worked out as steps: each triangle adds its area-weighted face normal
 * to its corners, every few thousand triangles hand the thread back, and the
 * sums are normalized the way three normalizes them. A person's body is tens
 * of thousands of triangles, which in one go held a frame for a good part of
 * the time a close person took to fit.
 *
 * @param position Float32Array of xyz per vertex
 * @param index the triangles' vertex indices, or null for a soup of triangles
 * @returns Float32Array of xyz per vertex
 */
export function* vertexNormals( position, index = null ) {

	const normal = new Float32Array( position.length );
	const triangles = ( index ? index.length : position.length / 3 ) / 3;

	for ( let triangle = 0; triangle < triangles; triangle ++ ) {

		if ( triangle && triangle % BATCH === 0 ) yield;
		const a = ( index ? index[ triangle * 3 ] : triangle * 3 ) * 3;
		const b = ( index ? index[ triangle * 3 + 1 ] : triangle * 3 + 1 ) * 3;
		const c = ( index ? index[ triangle * 3 + 2 ] : triangle * 3 + 2 ) * 3;
		// cb = c - b, ab = a - b, cb × ab, in three's order.
		const cbx = position[ c ] - position[ b ], cby = position[ c + 1 ] - position[ b + 1 ], cbz = position[ c + 2 ] - position[ b + 2 ];
		const abx = position[ a ] - position[ b ], aby = position[ a + 1 ] - position[ b + 1 ], abz = position[ a + 2 ] - position[ b + 2 ];
		const x = cby * abz - cbz * aby, y = cbz * abx - cbx * abz, z = cbx * aby - cby * abx;

		if ( index ) {

			// Three reads all three corners before it writes any, so a corner a
			// degenerate triangle names twice takes the face normal once.
			const ax = normal[ a ], ay = normal[ a + 1 ], az = normal[ a + 2 ];
			const bx = normal[ b ], by = normal[ b + 1 ], bz = normal[ b + 2 ];
			const cx = normal[ c ], cy = normal[ c + 1 ], cz = normal[ c + 2 ];
			normal[ a ] = ax + x; normal[ a + 1 ] = ay + y; normal[ a + 2 ] = az + z;
			normal[ b ] = bx + x; normal[ b + 1 ] = by + y; normal[ b + 2 ] = bz + z;
			normal[ c ] = cx + x; normal[ c + 1 ] = cy + y; normal[ c + 2 ] = cz + z;

		} else {

			for ( const corner of [ a, b, c ] ) {

				normal[ corner ] = x; normal[ corner + 1 ] = y; normal[ corner + 2 ] = z;

			}

		}

	}
	yield;
	for ( let i = 0; i < normal.length; i += 3 ) {

		const x = normal[ i ], y = normal[ i + 1 ], z = normal[ i + 2 ];
		const scale = 1 / ( Math.sqrt( x * x + y * y + z * z ) || 1 );
		normal[ i ] = x * scale; normal[ i + 1 ] = y * scale; normal[ i + 2 ] = z * scale;

	}

	return normal;

}
