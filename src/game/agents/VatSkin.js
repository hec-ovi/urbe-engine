/**
 * Linear-blend skinning of a run of frame rows, on plain arrays: no object per
 * vertex, no method call per component, which is what made the crowd bake
 * seconds of main thread.
 *
 * It computes what three's `SkinnedMesh.getVertexPosition` computes for a
 * position, and what VatBaker's authored-normal skin gives a normal:
 *
 * - position: `unbind · Σ w (bone · base)`, with `base = bind · p` read once
 *   per vertex, each product applied the way `Vector3.applyMatrix4` applies
 *   it, and zero weights skipped as three skips them;
 * - normal: the upper 3×3 of `unbind · Σ w bone · bind` applied to the
 *   authored normal and renormalised. For the affine matrices a skeleton is
 *   made of that 3×3 is the product of the three 3×3s, so `bind`'s part is
 *   applied once per vertex (`nb`) and only the blend is per row.
 *
 * @param source `{ count, bones, base, nb, joints, weights, unbind }`: vertex
 *   count, bones per palette, `base` and `nb` as xyz per vertex, four joints
 *   and weights per vertex, and the 16 elements of the bind matrix inverse
 * @param palettes each row's bone matrices (`bone.matrixWorld · boneInverse`),
 *   16 elements per bone, rows one after another
 * @param rows how many rows `palettes` holds
 * @param position, normal where the rows land, four floats per vertex per row
 */
export function skinRows( source, palettes, rows, position, normal ) {

	const { count, bones, base, nb, joints, weights, unbind: u } = source;

	for ( let row = 0; row < rows; row ++ ) {

		const palette = row * bones * 16;
		const out = row * count * 4;

		for ( let i = 0; i < count; i ++ ) {

			const bx = base[ i * 3 ], by = base[ i * 3 + 1 ], bz = base[ i * 3 + 2 ];
			let vx = 0, vy = 0, vz = 0;
			let s0 = 0, s1 = 0, s2 = 0, s4 = 0, s5 = 0, s6 = 0, s8 = 0, s9 = 0, s10 = 0;

			for ( let slot = 0; slot < 4; slot ++ ) {

				const w = weights[ i * 4 + slot ];
				if ( w === 0 ) continue;
				const m = palette + joints[ i * 4 + slot ] * 16;
				const e0 = palettes[ m ], e1 = palettes[ m + 1 ], e2 = palettes[ m + 2 ];
				const e4 = palettes[ m + 4 ], e5 = palettes[ m + 5 ], e6 = palettes[ m + 6 ];
				const e8 = palettes[ m + 8 ], e9 = palettes[ m + 9 ], e10 = palettes[ m + 10 ];
				const h = 1 / ( palettes[ m + 3 ] * bx + palettes[ m + 7 ] * by + palettes[ m + 11 ] * bz + palettes[ m + 15 ] );
				vx += ( e0 * bx + e4 * by + e8 * bz + palettes[ m + 12 ] ) * h * w;
				vy += ( e1 * bx + e5 * by + e9 * bz + palettes[ m + 13 ] ) * h * w;
				vz += ( e2 * bx + e6 * by + e10 * bz + palettes[ m + 14 ] ) * h * w;
				s0 += e0 * w; s1 += e1 * w; s2 += e2 * w;
				s4 += e4 * w; s5 += e5 * w; s6 += e6 * w;
				s8 += e8 * w; s9 += e9 * w; s10 += e10 * w;

			}

			const h = 1 / ( u[ 3 ] * vx + u[ 7 ] * vy + u[ 11 ] * vz + u[ 15 ] );
			const o = out + i * 4;
			position[ o ] = ( u[ 0 ] * vx + u[ 4 ] * vy + u[ 8 ] * vz + u[ 12 ] ) * h;
			position[ o + 1 ] = ( u[ 1 ] * vx + u[ 5 ] * vy + u[ 9 ] * vz + u[ 13 ] ) * h;
			position[ o + 2 ] = ( u[ 2 ] * vx + u[ 6 ] * vy + u[ 10 ] * vz + u[ 14 ] ) * h;

			const nx = nb[ i * 3 ], ny = nb[ i * 3 + 1 ], nz = nb[ i * 3 + 2 ];
			const mx = s0 * nx + s4 * ny + s8 * nz;
			const my = s1 * nx + s5 * ny + s9 * nz;
			const mz = s2 * nx + s6 * ny + s10 * nz;
			let x = u[ 0 ] * mx + u[ 4 ] * my + u[ 8 ] * mz;
			let y = u[ 1 ] * mx + u[ 5 ] * my + u[ 9 ] * mz;
			let z = u[ 2 ] * mx + u[ 6 ] * my + u[ 10 ] * mz;
			const length = Math.sqrt( x * x + y * y + z * z ) || 1;
			x /= length; y /= length; z /= length;
			normal[ o ] = x;
			normal[ o + 1 ] = y;
			normal[ o + 2 ] = z;

		}

	}

}
