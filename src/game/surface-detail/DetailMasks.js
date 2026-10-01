/**
 * The procedural stand-ins for the Materials surface-detail masks, drawn once
 * in plain JavaScript from a fixed seed, so a city wears the same wear on
 * every run and on every machine.
 *
 * `masks(size)` is one tileable RGBA field, a mask per channel, each drawn at
 * the scale the shader samples its channel at:
 *
 * - r `smudge`: broad smears and wipes, the oily patches (a tile is ~4 m)
 * - g `fingerprint`: fine greasy spots and dabs (~0.3 m)
 * - b `macro`: cloudy dirt (~2.4 m), and read eight times larger the slow
 *   variation that hides every repeat
 * - a `edge`: sharp broken noise the chips, flecks and worn edges threshold (~1.1 m)
 *
 * Every channel is equalised to an even spread of values, so a threshold in
 * the shader is a share of the surface: `smoothstep(0.8, 0.9, mask)` covers
 * about a sixth of it, whatever the noise looked like before.
 *
 * `frames(size)` holds a slab's own frame masks and the rain streaks, and
 * `decals(cell)` is the stain atlas, four columns by four rows of square
 * cells, alpha the coverage and colour the stain's own linear albedo. Row 0
 * holds oil stains, row 1 cracks, row 2 water marks and dried spills, row 3
 * gum and grit. Every mark stays inside its cell, clear of the border.
 */

export const DECAL_GRID = 4;

const SEED = 0x5eed1a7e;

/** A small, fast, seeded generator (mulberry32). */
export function random( seed ) {

	let state = seed >>> 0;

	return () => {

		state = ( state + 0x6d2b79f5 ) >>> 0;
		let t = state;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );

		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

/** A lattice of random values that wraps at `px` by `py` cells. */
function lattice( next, px, py ) {

	const values = new Float32Array( px * py );
	for ( let index = 0; index < values.length; index ++ ) values[ index ] = next();

	return { values, px, py };

}

const fade = ( t ) => t * t * t * ( t * ( t * 6 - 15 ) + 10 );

/** Value noise on a wrapping lattice, at (u, v) in tile units [0, 1). */
function sample( { values, px, py }, u, v ) {

	const x = u * px, y = v * py;
	const x0 = Math.floor( x ), y0 = Math.floor( y );
	const fx = fade( x - x0 ), fy = fade( y - y0 );
	const i0 = ( ( x0 % px ) + px ) % px, j0 = ( ( y0 % py ) + py ) % py;
	const i1 = ( i0 + 1 ) % px, j1 = ( j0 + 1 ) % py;
	const a = values[ j0 * px + i0 ], b = values[ j0 * px + i1 ];
	const c = values[ j1 * px + i0 ], d = values[ j1 * px + i1 ];

	return a + ( b - a ) * fx + ( c - a ) * fy + ( a - b - c + d ) * fx * fy;

}

/** Octaves of wrapping noise, each twice the frequency and half the weight of the last. */
function fbm( next, px, py, octaves, gain = 0.5 ) {

	const layers = [];
	for ( let octave = 0; octave < octaves; octave ++ ) layers.push( lattice( next, px << octave, py << octave ) );

	return ( u, v ) => {

		let sum = 0, weight = 1, total = 0;
		for ( const layer of layers ) {

			sum += sample( layer, u, v ) * weight;
			total += weight;
			weight *= gain;

		}

		return sum / total;

	};

}

/** Wraps a coordinate into [0, 1). */
const wrap = ( t ) => t - Math.floor( t );

/** Replaces each value by its rank, so the channel covers 0..1 evenly. */
function equalise( field ) {

	const order = new Uint32Array( field.length );
	for ( let index = 0; index < order.length; index ++ ) order[ index ] = index;
	order.sort( ( a, b ) => field[ a ] - field[ b ] );
	const out = new Float32Array( field.length );
	const last = Math.max( 1, field.length - 1 );
	for ( let rank = 0; rank < order.length; rank ++ ) out[ order[ rank ] ] = rank / last;

	return out;

}

const smooth = ( a, b, t ) => {

	const x = Math.min( 1, Math.max( 0, ( t - a ) / ( b - a ) ) );

	return x * x * ( 3 - 2 * x );

};

/**
 * The four masks, `size` pixels square (a power of two), RGBA8.
 * @returns Uint8Array of size * size * 4
 */
export function masks( size = 256 ) {

	const next = random( SEED );
	const pixels = size * size;
	const fields = { r: new Float32Array( pixels ), g: new Float32Array( pixels ), b: new Float32Array( pixels ), a: new Float32Array( pixels ) };

	// Smudge: warped blotches crossed by wipes along both street axes, the way
	// a mop, a sole or a tyre drags grease one way across a slab.
	const warpX = fbm( next, 3, 3, 3 ), warpY = fbm( next, 3, 3, 3 );
	const blots = fbm( next, 4, 4, 5, 0.55 );
	const wipeAlong = fbm( next, 2, 20, 3 ), wipeAcross = fbm( next, 20, 2, 3 );
	const wipeMask = fbm( next, 3, 3, 2 );
	// Fingerprint: dense small dabs, warped so they smear rather than dot.
	const dabWarp = fbm( next, 5, 5, 2 );
	const dabs = fbm( next, 7, 7, 4, 0.6 );
	const film = fbm( next, 16, 16, 2 );
	// Macro: slow clouds.
	const clouds = fbm( next, 3, 3, 4, 0.5 );
	// Edge: broken, high-frequency, ridged so it thresholds into chips.
	const chips = fbm( next, 9, 9, 5, 0.62 );
	const ridges = fbm( next, 5, 5, 3 );

	for ( let j = 0; j < size; j ++ ) {

		const v = j / size;
		for ( let i = 0; i < size; i ++ ) {

			const u = i / size, index = j * size + i;
			const du = ( warpX( u, v ) - 0.5 ) * 0.45, dv = ( warpY( u, v ) - 0.5 ) * 0.45;
			const blot = blots( wrap( u + du ), wrap( v + dv ) );
			const wipes = Math.max( wipeAlong( u, wrap( v + dv * 0.3 ) ), wipeAcross( wrap( u + du * 0.3 ), v ) );
			fields.r[ index ] = blot * 0.62 + wipes * 0.38 * smooth( 0.35, 0.75, wipeMask( u, v ) );

			const w = ( dabWarp( u, v ) - 0.5 ) * 0.25;
			fields.g[ index ] = dabs( wrap( u + w ), wrap( v - w ) ) * 0.8 + film( u, v ) * 0.2;

			fields.b[ index ] = clouds( u, v );

			fields.a[ index ] = chips( u, v ) * 0.7 + Math.abs( ridges( u, v ) - 0.5 ) * 0.6;

		}

	}

	const out = new Uint8Array( pixels * 4 );
	[ 'r', 'g', 'b', 'a' ].forEach( ( channel, offset ) => {

		const field = equalise( fields[ channel ] );
		for ( let index = 0; index < pixels; index ++ ) out[ index * 4 + offset ] = Math.round( field[ index ] * 255 );

	} );

	return out;

}

/**
 * The panel masks, `size` pixels square, RGBA8: red scuffs along a 0..1
 * slab's border, green paint chips along it (both read in a slab's own UV
 * and zero across its middle), blue vertical rain streaks (read in world
 * metres on a wall, ~2 m a repeat, equalised), alpha unused.
 */
export function frames( size = 256 ) {

	const next = random( SEED ^ 0x0f4a3e5 );
	const pixels = size * size;
	const scuff = new Float32Array( pixels ), chips = new Float32Array( pixels ), streaks = new Float32Array( pixels );
	const rough = fbm( next, 8, 8, 4, 0.6 ), flake = fbm( next, 24, 24, 3, 0.55 );
	const runs = fbm( next, 28, 2, 3, 0.5 ), stains = fbm( next, 4, 2, 3 );

	for ( let j = 0; j < size; j ++ ) {

		const v = j / size;
		for ( let i = 0; i < size; i ++ ) {

			const u = i / size, index = j * size + i;
			const edge = Math.min( u, v, 1 - u, 1 - v );
			const n = rough( u, v );
			scuff[ index ] = smooth( 0.14, 0, edge + ( n - 0.5 ) * 0.08 ) * ( 0.45 + 0.55 * n );
			chips[ index ] = smooth( 0.06, 0, edge + ( flake( u, v ) - 0.5 ) * 0.07 ) * smooth( 0.45, 0.6, flake( u, v ) );
			streaks[ index ] = runs( u, v ) * 0.7 + stains( u, v ) * 0.3;

		}

	}

	const out = new Uint8Array( pixels * 4 );
	const even = equalise( streaks );
	for ( let index = 0; index < pixels; index ++ ) {

		out[ index * 4 ] = Math.round( Math.min( 1, scuff[ index ] ) * 255 );
		out[ index * 4 + 1 ] = Math.round( Math.min( 1, chips[ index ] ) * 255 );
		out[ index * 4 + 2 ] = Math.round( even[ index ] * 255 );

	}

	return out;

}

/**
 * Spreads one 8 bit channel of an RGBA buffer evenly over 0..255 by its own
 * histogram; equal values stay equal (each takes the middle of its rank).
 */
export function equaliseChannel( pixels, channel ) {

	const counts = new Float64Array( 256 );
	for ( let index = channel; index < pixels.length; index += 4 ) counts[ pixels[ index ] ] ++;
	const total = pixels.length / 4, map = new Uint8Array( 256 );
	let below = 0;
	for ( let value = 0; value < 256; value ++ ) {

		map[ value ] = Math.round( ( ( below + counts[ value ] / 2 ) / total ) * 255 );
		below += counts[ value ];

	}
	for ( let index = channel; index < pixels.length; index += 4 ) pixels[ index ] = map[ pixels[ index ] ];

	return pixels;

}

/** A square RGBA8 field resampled bilinearly, with wrapping, to `size`. */
export function resample( pixels, from, size ) {

	if ( from === size ) return pixels;
	const out = new Uint8Array( size * size * 4 );
	for ( let j = 0; j < size; j ++ ) {

		const y = ( j + 0.5 ) * from / size - 0.5, y0 = Math.floor( y ), fy = y - y0;
		const r0 = ( ( y0 % from ) + from ) % from, r1 = ( r0 + 1 ) % from;
		for ( let i = 0; i < size; i ++ ) {

			const x = ( i + 0.5 ) * from / size - 0.5, x0 = Math.floor( x ), fx = x - x0;
			const c0 = ( ( x0 % from ) + from ) % from, c1 = ( c0 + 1 ) % from;
			for ( let k = 0; k < 4; k ++ ) {

				const a = pixels[ ( r0 * from + c0 ) * 4 + k ], b = pixels[ ( r0 * from + c1 ) * 4 + k ];
				const c = pixels[ ( r1 * from + c0 ) * 4 + k ], d = pixels[ ( r1 * from + c1 ) * 4 + k ];
				out[ ( j * size + i ) * 4 + k ] = Math.round( ( a * ( 1 - fx ) + b * fx ) * ( 1 - fy ) + ( c * ( 1 - fx ) + d * fx ) * fy );

			}

		}

	}

	return out;

}

/**
 * Linear albedo of each decal row, the roughness the shader gives it, and the
 * tone and saturation it gives an atlas's own colour: a published oil stain is
 * drawn brown on white and lies far darker and greyer, near black, on a street,
 * and a dried water mark is a dull grey rim, never a white one.
 */
export const DECAL_ROWS = Object.freeze( [
	{ name: 'oil', color: [ 0.018, 0.016, 0.014 ], roughness: 0.1, tone: 0.3, saturation: 0.3 },
	{ name: 'crack', color: [ 0.012, 0.012, 0.012 ], roughness: 0.95, tone: 1, saturation: 1 },
	{ name: 'water', color: [ 0.3, 0.29, 0.27 ], roughness: 0.3, tone: 0.55, saturation: 0.6 },
	{ name: 'gum', color: [ 0.03, 0.03, 0.028 ], roughness: 0.72, tone: 1, saturation: 1 }
] );

/**
 * The stain atlas, `DECAL_GRID` cells square of `cell` pixels each, RGBA8.
 * @returns Uint8Array of (cell * DECAL_GRID)^2 * 4
 */
export function decals( cell = 128 ) {

	const next = random( SEED ^ 0x0d3ca15 );
	const side = cell * DECAL_GRID;
	const out = new Uint8Array( side * side * 4 );
	const outline = fbm( next, 6, 1, 3 );
	const grain = fbm( next, 12, 12, 3 );

	for ( let row = 0; row < DECAL_GRID; row ++ ) {

		for ( let column = 0; column < DECAL_GRID; column ++ ) {

			const alpha = DRAW[ row ]( next, cell, outline, grain );
			const [ r, g, b ] = DECAL_ROWS[ row ].color;
			for ( let y = 0; y < cell; y ++ ) {

				for ( let x = 0; x < cell; x ++ ) {

					const index = ( ( row * cell + y ) * side + column * cell + x ) * 4;
					out[ index ] = Math.round( r * 255 );
					out[ index + 1 ] = Math.round( g * 255 );
					out[ index + 2 ] = Math.round( b * 255 );
					out[ index + 3 ] = Math.round( Math.min( 1, Math.max( 0, alpha[ y * cell + x ] ) ) * 255 );

				}

			}

		}

	}

	return out;

}

/** Each row's coverage for one cell, in cell units centred on 0.5 and kept inside 0.08..0.92. */
const DRAW = [ oilStain, crackWeb, waterMark, gumAndGrit ];

/** A soft, lobed pool, darker at its heart, with drips thrown off it. */
function oilStain( next, cell, outline, grain ) {

	const alpha = new Float32Array( cell * cell );
	const cx = 0.5 + ( next() - 0.5 ) * 0.08, cy = 0.5 + ( next() - 0.5 ) * 0.08;
	const radius = 0.24 + next() * 0.1, turn = next();
	const drops = Array.from( { length: 3 + Math.floor( next() * 5 ) }, () => {

		const angle = next() * Math.PI * 2, reach = radius * ( 1.05 + next() * 0.4 );
		return { x: cx + Math.cos( angle ) * reach, y: cy + Math.sin( angle ) * reach, r: 0.012 + next() * 0.03 };

	} );
	for ( let y = 0; y < cell; y ++ ) {

		for ( let x = 0; x < cell; x ++ ) {

			const u = ( x + 0.5 ) / cell, v = ( y + 0.5 ) / cell;
			const dx = u - cx, dy = v - cy, d = Math.hypot( dx, dy );
			const edge = radius * ( 0.72 + 0.56 * outline( wrap( Math.atan2( dy, dx ) / ( Math.PI * 2 ) + turn ), 0 ) );
			let a = smooth( edge, edge * 0.5, d ) * ( 0.55 + 0.45 * smooth( edge * 0.8, 0, d ) ) * ( 0.75 + 0.25 * grain( u, v ) );
			for ( const drop of drops ) a = Math.max( a, smooth( drop.r, drop.r * 0.5, Math.hypot( u - drop.x, v - drop.y ) ) * 0.8 );
			alpha[ y * cell + x ] = a * border( u, v );

		}

	}

	return alpha;

}

/** Branching hairline cracks walked out from near the centre. */
function crackWeb( next, cell ) {

	const segments = [];
	const walk = ( x, y, angle, length, depth ) => {

		let px = x, py = y;
		const steps = Math.max( 2, Math.round( length / 0.03 ) );
		for ( let step = 0; step < steps; step ++ ) {

			angle += ( next() - 0.5 ) * 0.9;
			const nx = px + Math.cos( angle ) * 0.03, ny = py + Math.sin( angle ) * 0.03;
			if ( nx < 0.1 || nx > 0.9 || ny < 0.1 || ny > 0.9 ) return;
			segments.push( [ px, py, nx, ny, 1 - depth * 0.3 ] );
			if ( depth < 2 && next() < 0.12 ) walk( nx, ny, angle + ( next() < 0.5 ? - 1 : 1 ) * ( 0.6 + next() * 0.6 ), length * 0.5, depth + 1 );
			px = nx; py = ny;

		}

	};
	const x = 0.45 + next() * 0.1, y = 0.45 + next() * 0.1;
	const arms = 2 + Math.floor( next() * 3 );
	for ( let arm = 0; arm < arms; arm ++ ) walk( x, y, ( arm / arms ) * Math.PI * 2 + next(), 0.28 + next() * 0.2, 0 );

	// Each segment only touches the pixels within its reach.
	const alpha = new Float32Array( cell * cell );
	const width = 1.1 / cell, reach = width * 4;
	for ( const [ x0, y0, x1, y1, weight ] of segments ) {

		const left = Math.max( 0, Math.floor( ( Math.min( x0, x1 ) - reach ) * cell ) ), right = Math.min( cell - 1, Math.ceil( ( Math.max( x0, x1 ) + reach ) * cell ) );
		const top = Math.max( 0, Math.floor( ( Math.min( y0, y1 ) - reach ) * cell ) ), bottom = Math.min( cell - 1, Math.ceil( ( Math.max( y0, y1 ) + reach ) * cell ) );
		for ( let py = top; py <= bottom; py ++ ) {

			for ( let px = left; px <= right; px ++ ) {

				const d = segmentDistance( ( px + 0.5 ) / cell, ( py + 0.5 ) / cell, x0, y0, x1, y1 );
				const index = py * cell + px;
				alpha[ index ] = Math.max( alpha[ index ], Math.min( 1, weight * ( smooth( width * 1.6, width * 0.4, d ) + 0.25 * smooth( reach, width, d ) ) ) );

			}

		}

	}
	for ( let py = 0; py < cell; py ++ ) for ( let px = 0; px < cell; px ++ ) alpha[ py * cell + px ] *= border( ( px + 0.5 ) / cell, ( py + 0.5 ) / cell );

	return alpha;

}

/** The rim a dried puddle or spill leaves, faint inside. */
function waterMark( next, cell, outline, grain ) {

	const alpha = new Float32Array( cell * cell );
	const cx = 0.5 + ( next() - 0.5 ) * 0.1, cy = 0.5 + ( next() - 0.5 ) * 0.1;
	const radius = 0.26 + next() * 0.1, turn = next();
	for ( let y = 0; y < cell; y ++ ) {

		for ( let x = 0; x < cell; x ++ ) {

			const u = ( x + 0.5 ) / cell, v = ( y + 0.5 ) / cell;
			const dx = u - cx, dy = v - cy, d = Math.hypot( dx, dy );
			const edge = radius * ( 0.7 + 0.6 * outline( wrap( Math.atan2( dy, dx ) / ( Math.PI * 2 ) + turn ), 0.5 ) );
			const rim = Math.exp( - ( ( ( d - edge ) / 0.018 ) ** 2 ) );
			const inside = smooth( edge, edge * 0.85, d ) * 0.22 * grain( u, v );
			alpha[ y * cell + x ] = Math.min( 1, rim * 0.75 + inside ) * border( u, v );

		}

	}

	return alpha;

}

/** Flattened gum and grit, a scatter of small dark discs. */
function gumAndGrit( next, cell ) {

	const alpha = new Float32Array( cell * cell );
	const spots = Array.from( { length: 4 + Math.floor( next() * 9 ) }, () => ( {
		x: 0.15 + next() * 0.7, y: 0.15 + next() * 0.7, r: 0.018 + next() * 0.035, a: 0.6 + next() * 0.4
	} ) );
	for ( let y = 0; y < cell; y ++ ) {

		for ( let x = 0; x < cell; x ++ ) {

			const u = ( x + 0.5 ) / cell, v = ( y + 0.5 ) / cell;
			let a = 0;
			for ( const spot of spots ) a = Math.max( a, smooth( spot.r, spot.r * 0.6, Math.hypot( u - spot.x, v - spot.y ) ) * spot.a );
			alpha[ y * cell + x ] = a * border( u, v );

		}

	}

	return alpha;

}

/** Fades every mark out before its cell's edge, so neighbours and mip levels never bleed. */
function border( u, v ) {

	return smooth( 0.02, 0.1, Math.min( u, v, 1 - u, 1 - v ) );

}

function segmentDistance( x, y, x0, y0, x1, y1 ) {

	const dx = x1 - x0, dy = y1 - y0;
	const t = Math.max( 0, Math.min( 1, ( ( x - x0 ) * dx + ( y - y0 ) * dy ) / ( dx * dx + dy * dy || 1 ) ) );

	return Math.hypot( x - x0 - t * dx, y - y0 - t * dy );

}
