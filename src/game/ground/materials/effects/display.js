import { clamp, color, dFdx, dFdy, float, floor, int, max, min, mod, select, vec2, vec4 } from 'three/tsl';

/** The marquee face the shared street kit publishes, in metres along its own slope. */
const FACE = { width: 1.8, height: Math.hypot( 0.44, 0.44 * 0.16 / 0.46 ), glyph: 0.24 };
/** The Materials letter atlas is eight columns by six rows, row major. */
const COLUMNS = 8, ROWS = 6;

export function display( s, p ) {
	const face = s.text ? letters( s ) : s.map( 'basecolor' );
	const lit = face.rgb.mul( color( p.tint ) );
	return {
		colorNode: lit, emissiveNode: lit.mul( p.brightness ), roughnessNode: float( p.roughness ), metalnessNode: float( 0 ),
		...( s.text ? { opacityNode: face.a } : {} )
	};
}

/**
 * The glyphs this copy carries, read off the letter atlas.
 *
 * The text stands as one centred row of square cells, each as wide as it is
 * tall along the face's slope and never wider than the atlas cell itself, and
 * each glyph reads its own cell of the sheet. Outside that row, and where a
 * glyph is the blank space cell, the face is transparent and the frame behind
 * it shows.
 */
function letters( s ) {
	const count = max( s.text.count, 1 ).toConst();
	const cell = min( FACE.glyph, float( FACE.width ).div( count ) ).toConst();
	const row = vec2( cell.mul( count ).div( FACE.width ), cell.div( FACE.height ) ).toConst();
	// Where the fragment falls in the row: whole glyphs across, one cell up.
	const local = s.uv.sub( row.oneMinus().mul( 0.5 ) ).div( row ).mul( vec2( count, 1 ) ).toConst();
	const index = floor( local.x ).toConst();
	const glyph = s.text.glyph( int( clamp( index, 0, count.sub( 1 ) ) ) ).toConst();
	const inside = local.x.greaterThanEqual( 0 ).and( local.x.lessThan( count ) )
		.and( local.y.greaterThanEqual( 0 ) ).and( local.y.lessThanEqual( 1 ) );

	const atlas = vec2( mod( glyph, COLUMNS ).add( local.x.sub( index ) ).div( COLUMNS ),
		floor( glyph.div( COLUMNS ) ).add( 1 ).div( ROWS ).oneMinus().add( local.y.div( ROWS ) ) );
	const scale = vec2( 1 / COLUMNS, 1 / ROWS );
	// One cell per glyph, so the coordinate jumps at every glyph edge: the
	// sheet is sampled at the row's own footprint instead of that jump.
	const art = s.map( 'basecolor', atlas ).grad( dFdx( local ).mul( scale ), dFdy( local ).mul( scale ) );

	// The sheet is emissive art on black and carries no alpha, so the glyph's
	// own light is what stands on the face and a blank cell reads as nothing.
	return vec4( art.rgb, select( inside, max( max( art.r, art.g ), art.b ), 0 ) );
}
