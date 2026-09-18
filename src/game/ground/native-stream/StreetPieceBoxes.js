/** Heightfield resolution, in metres: curb and panel edges sit on 0.1 m. */
const CELL = 0.1;
/** Tops closer than this are one walking level, so a gutter belongs to its road. */
const LEVEL_GAP = 0.06;
/** How far under its walking surface a cuboid reaches. */
const SKIRT = 0.2;
const MAX_CELLS = 1 << 20;

/**
 * One kit piece's standing volume, as the cuboids a player walks on.
 *
 * A piece is a whole street cross section, so its published bounds are one box
 * from the road to the top of the curb: admitting that box would pave the
 * roadway at sidewalk height and lose the step. The collidable triangles are
 * sampled into a piece-local heightfield instead, their tops grouped into
 * walking levels, and each level's cells merged into the few rectangles that
 * cover it. A straight segment comes out as its road and its two sidewalk
 * bands, with the authored curb between them.
 *
 * Every copy of the piece reuses these boxes: one placement rotates and moves
 * them, it never recomputes them.
 *
 * @param triangles piece-local vertices, nine numbers per triangle
 * @param bounds the kit's published piece bounds
 * @returns [{ center, halfExtents }] in piece coordinates
 */
export function streetPieceBoxes( triangles, bounds ) {

	const [ x0, y0, z0 ] = bounds.min, [ x1, , z1 ] = bounds.max;
	const width = Math.max( CELL, x1 - x0 ), depth = Math.max( CELL, z1 - z0 );
	const cell = Math.max( CELL, Math.sqrt( width * depth / MAX_CELLS ) );
	const nx = Math.ceil( width / cell ), nz = Math.ceil( depth / cell );
	const top = new Float32Array( nx * nz ).fill( - Infinity );

	for ( let t = 0; t + 8 < triangles.length; t += 9 ) sample( top, triangles, t, { x0, z0, nx, nz, cell } );

	const levels = walkingLevels( top );
	if ( ! levels.heights.length ) return [];

	const at = new Int16Array( nx * nz ).fill( - 1 );
	for ( let index = 0; index < top.length; index ++ ) if ( top[ index ] > - Infinity ) at[ index ] = levels.of.get( key( top[ index ] ) );

	return rectangles( at, nx, nz ).map( ( { i0, i1, j0, j1, level } ) => {
		const height = levels.heights[ level ], minY = Math.min( y0, height ) - SKIRT;
		return {
			center: [ x0 + ( i0 + i1 + 1 ) * cell / 2, ( minY + height ) / 2, z0 + ( j0 + j1 + 1 ) * cell / 2 ],
			halfExtents: [ ( i1 - i0 + 1 ) * cell / 2, ( height - minY ) / 2, ( j1 - j0 + 1 ) * cell / 2 ]
		};
	} );

}

/** The highest surface over each cell centre the triangle covers. */
function sample( top, triangles, t, { x0, z0, nx, nz, cell } ) {

	const ax = triangles[ t ], ay = triangles[ t + 1 ], az = triangles[ t + 2 ];
	const bx = triangles[ t + 3 ], by = triangles[ t + 4 ], bz = triangles[ t + 5 ];
	const cx = triangles[ t + 6 ], cy = triangles[ t + 7 ], cz = triangles[ t + 8 ];
	// A vertical face covers no ground; the cuboid's own side answers for it.
	const area = ( bx - ax ) * ( cz - az ) - ( bz - az ) * ( cx - ax );
	if ( Math.abs( area ) < 1e-9 ) return;

	const i0 = Math.max( 0, Math.floor( ( Math.min( ax, bx, cx ) - x0 ) / cell ) );
	const i1 = Math.min( nx - 1, Math.floor( ( Math.max( ax, bx, cx ) - x0 ) / cell ) );
	const j0 = Math.max( 0, Math.floor( ( Math.min( az, bz, cz ) - z0 ) / cell ) );
	const j1 = Math.min( nz - 1, Math.floor( ( Math.max( az, bz, cz ) - z0 ) / cell ) );

	for ( let i = i0; i <= i1; i ++ ) {
		const px = x0 + ( i + 0.5 ) * cell;
		for ( let j = j0; j <= j1; j ++ ) {
			const pz = z0 + ( j + 0.5 ) * cell;
			const u = ( ( bx - ax ) * ( pz - az ) - ( bz - az ) * ( px - ax ) ) / area;
			const v = ( ( px - ax ) * ( cz - az ) - ( pz - az ) * ( cx - ax ) ) / area;
			if ( u < 0 || v < 0 || u + v > 1 ) continue;
			const y = ay + v * ( by - ay ) + u * ( cy - ay );
			const index = i * nz + j;
			if ( y > top[ index ] ) top[ index ] = y;
		}
	}

}

/**
 * The levels a player stands on.
 *
 * The heights covering most of the piece are its real surfaces, so they are
 * claimed first, largest area down, and a height within one step of a claimed
 * level joins it instead of becoming its own. A crossing ramp therefore never
 * chains the road into the sidewalk: the road keeps 0, the sidewalk keeps its
 * authored 0.2 m, and the slope between them lands on the nearest level, never
 * more than one step from the surface it was cut from.
 */
function walkingLevels( top ) {

	const area = new Map();
	for ( const height of top ) if ( height > - Infinity ) area.set( key( height ), ( area.get( key( height ) ) ?? 0 ) + 1 );

	const gap = LEVEL_GAP * 1000, heights = [];
	for ( const height of [ ...area.keys() ].sort( ( a, b ) => area.get( b ) - area.get( a ) || a - b ) ) {
		if ( ! heights.some( claimed => Math.abs( height - claimed ) <= gap ) ) heights.push( height );
	}
	heights.sort( ( a, b ) => a - b );

	const of = new Map();
	for ( const height of area.keys() ) {
		let best = 0;
		for ( let level = 1; level < heights.length; level ++ ) {
			if ( Math.abs( height - heights[ level ] ) < Math.abs( height - heights[ best ] ) ) best = level;
		}
		of.set( height, best );
	}

	return { heights: heights.map( height => height / 1000 ), of };

}

/** Heights are grouped by the millimetre they land on. */
function key( height ) {

	return Math.round( height * 1000 );

}

/** Greedy maximal rectangles over the cells of one level. */
function rectangles( at, nx, nz ) {

	const used = new Uint8Array( at.length ), out = [];

	for ( let i = 0; i < nx; i ++ ) for ( let j = 0; j < nz; j ++ ) {

		const start = i * nz + j;
		if ( used[ start ] || at[ start ] < 0 ) continue;
		const level = at[ start ];

		let j1 = j;
		while ( j1 + 1 < nz && ! used[ i * nz + j1 + 1 ] && at[ i * nz + j1 + 1 ] === level ) j1 ++;

		let i1 = i;
		while ( i1 + 1 < nx && wholeRow( at, used, i1 + 1, j, j1, nz, level ) ) i1 ++;

		for ( let ii = i; ii <= i1; ii ++ ) used.fill( 1, ii * nz + j, ii * nz + j1 + 1 );
		out.push( { i0: i, i1, j0: j, j1, level } );

	}

	return out;

}

function wholeRow( at, used, i, j0, j1, nz, level ) {

	for ( let j = j0; j <= j1; j ++ ) if ( used[ i * nz + j ] || at[ i * nz + j ] !== level ) return false;
	return true;

}
