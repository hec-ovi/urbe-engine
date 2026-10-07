import { abs, atan, attribute, clamp, float, floor, fract, max, min, mix, mod, normalWorldGeometry, positionWorld, select, smoothstep, texture, vec2, vec3 } from 'three/tsl';
import { hash32 } from './SurfaceDetail.js';

/**
 * Wear on an elevated highway, laid over the concrete each part's maps paint,
 * from where the part really is in the structure (Materials
 * `sources/highway-concrete/placement-mask-spec.json`), never from a texture
 * repeat or from world height zero:
 *
 * - `highway-pier`: splash and dirt gathered at the foot of each pier, over
 *   the lowest ~0.6 m above that pier's own base, and water run down the shaft
 *   from the bearing seat.
 * - `highway-soffit`: soot and damp deposits under the deck gathered along each
 *   expansion joint, the joint's real station, and broad exhaust soot.
 * - `highway-deck`: runoff streaks down the slab's fascia below the parapet,
 *   heaviest under the joints, following gravity.
 * - `highway-barrier`: tyre spray low on the road face, rubber scuffs where
 *   wheels brushed it, a cap polished smoother by hands, and runoff down the
 *   outer face from the cap.
 *
 * The parts carry what they are as vertex attributes ([Highways](../ground/Highways.js)):
 * `_highway_source` (the route station and the roadway level there),
 * `_highway_face` (the face flags as a float: cap 1, chamfer 2, drip 4, end 8,
 * road side 16) and `_highway_context` (the owning support's base and top, and
 * the stations of the joints either side).
 */

const GRIME = vec3( 0.03, 0.027, 0.023 );
const RUBBER = vec3( 0.018, 0.017, 0.016 );

/** Bit `value` of a face's flags. */
const flag = ( face, value ) => mod( floor( face.div( value ) ), 2 );

function parts() {

	const source = attribute( '_highway_source', 'vec2' );
	const face = attribute( '_highway_face', 'float' );
	const context = attribute( '_highway_context', 'vec4' );
	const n = normalWorldGeometry;

	return {
		station: source.x, deckLevel: source.y, face, base: context.x, top: context.y,
		joint: min( abs( source.x.sub( context.z ) ), abs( context.w.sub( source.x ) ) ).toConst(),
		upright: smoothstep( 0.35, 0.7, abs( n.y ) ).oneMinus().toConst(),
		downward: smoothstep( 0.35, 0.75, n.y.negate() ).toConst(),
		// Along the face it lies on, so streaks fall straight whichever way the face turns.
		run: select( abs( n.x ).greaterThan( abs( n.z ) ), positionWorld.z, positionWorld.x ).toConst()
	};

}

/** City-scale tone and a dirt field at metres `q`. */
function fields( detail, q ) {

	return {
		macro: detail.sample( 'macro', q.add( 23.7 ), 8 ).toConst(),
		dirt: detail.sample( 'macro', q.mul( 1.3 ).add( 5.1 ) ).toConst(),
		edge: detail.sample( 'edge', q.add( 2.9 ) ).toConst(),
		smudge: detail.sample( 'smudge', q.add( 7.7 ) ).toConst()
	};

}

/** Narrow streaks falling down a face at `run` along it, `fall` metres below where they start. */
function streaks( detail, run, height, fall ) {

	const s = detail.sample( 'streaks', vec2( run, height.mul( 0.4 ) ).add( 3.1 ) );

	return smoothstep( 0.5, 0.86, s ).mul( smoothstep( 0, 0.25, fall ) ).mul( smoothstep( 0.4, 3.5, fall ).oneMinus() ).toConst();

}

export function highwayPier( detail, { color, roughness } ) {

	const h = parts();
	const above = positionWorld.y.sub( h.base );
	const q = vec2( h.run, positionWorld.y );
	const m = fields( detail, q );
	// The foot's edge rises and falls along the pier, never a ruled band:
	// splash to knee height, soaked darkest in the first hand's width.
	const contact = smoothstep( 0.1, 1.05, above.add( m.dirt.sub( 0.5 ).mul( 0.55 ) ) ).oneMinus().mul( h.upright ).toConst();
	const soaked = smoothstep( 0.02, 0.18, above ).oneMinus().mul( h.upright ).toConst();
	const damp = contact.mul( smoothstep( 0.6, 0.85, m.smudge ) ).toConst();
	// Water from the bearing seat runs down from the top, rust-tinted on some faces.
	const run = streaks( detail, h.run, positionWorld.y, h.top.sub( positionWorld.y ) ).mul( h.upright ).mul( smoothstep( 0.25, 0.65, m.macro ) ).toConst();
	const rusty = smoothstep( 0.55, 0.8, m.edge );

	let c = color.mul( m.macro.sub( 0.5 ).mul( 0.22 ).add( 0.88 ) );
	c = mix( c, c.mul( vec3( 0.62, 0.59, 0.55 ) ), contact.mul( m.dirt.mul( 0.4 ).add( 0.6 ) ) );
	c = mix( c, c.mul( 0.55 ), soaked.mul( 0.6 ) );
	c = mix( c, mix( mix( c, GRIME, 0.5 ), vec3( 0.12, 0.06, 0.03 ), rusty.mul( 0.5 ) ), run.mul( 0.75 ) );
	let r = roughness.add( contact.mul( 0.1 ) );
	r = mix( r, r.mul( 0.65 ), damp );
	r = mix( r, r.mul( 0.8 ), run.mul( 0.5 ) );

	return { color: c, roughness: clamp( r, 0.05, 1 ) };

}

export function highwaySoffit( detail, { color, roughness } ) {

	const h = parts();
	const m = fields( detail, positionWorld.xz );
	const deposit = smoothstep( 0.08, 0.8, h.joint.add( m.dirt.sub( 0.5 ).mul( 0.25 ) ) ).oneMinus().mul( max( h.downward, h.upright.mul( 0.5 ) ) ).toConst();
	const soot = smoothstep( 0.25, 0.75, m.macro ).mul( 0.6 ).add( m.dirt.mul( 0.4 ) ).toConst();

	let c = color.mul( m.macro.sub( 0.5 ).mul( 0.16 ).add( 1 ) );
	c = c.mul( soot.mul( 0.22 ).oneMinus() );
	c = mix( c, c.mul( 0.7 ), deposit.mul( smoothstep( 0.25, 0.7, m.edge ).mul( 0.5 ).add( 0.5 ) ) );
	const r = roughness.add( deposit.mul( m.smudge.sub( 0.5 ).mul( 0.12 ) ) ).add( soot.mul( 0.03 ) );

	return { color: c, roughness: clamp( r, 0.05, 1 ) };

}

export function highwayDeck( detail, { color, roughness } ) {

	const h = parts();
	const m = fields( detail, vec2( h.run, positionWorld.y ) );
	// Water leaves the deck over its edge, most of it at the joints, and soot rides it.
	const origin = max( smoothstep( 0.3, 2.4, h.joint ).oneMinus(), float( 0.45 ) );
	const run = streaks( detail, h.run, positionWorld.y, h.deckLevel.sub( positionWorld.y ) ).mul( h.upright ).mul( origin ).toConst();

	let c = color.mul( m.macro.sub( 0.5 ).mul( 0.2 ).add( 0.86 ) );
	c = mix( c, mix( c, GRIME, 0.6 ), run.mul( 0.8 ) );
	const r = mix( roughness, roughness.mul( 0.8 ), run.mul( 0.5 ) );

	return { color: c, roughness: clamp( r, 0.05, 1 ) };

}

export function highwayBarrier( detail, { color, roughness } ) {

	const h = parts();
	const above = positionWorld.y.sub( h.deckLevel ).toConst();
	const road = flag( h.face, 16 ), cap = max( flag( h.face, 1 ), flag( h.face, 2 ) ).mul( select( abs( normalWorldGeometry.y ).greaterThan( 0.3 ), float( 1 ), float( 0.4 ) ) );
	const m = fields( detail, vec2( h.station, above ) );
	// Tyre spray and road dirt climb the road face to the knee, thickest at its foot.
	const splash = smoothstep( 0.04, 0.45, above.add( m.dirt.sub( 0.5 ).mul( 0.2 ) ) ).oneMinus().mul( h.upright ).mul( road.mul( 0.7 ).add( 0.3 ) ).toConst();
	// Wheels brush the road face between ankle and knee, in long black smears.
	const scuff = smoothstep( 0.56, 0.8, detail.sample( 'edge', vec2( h.station.mul( 0.15 ), above.mul( 2.4 ) ).add( 9.4 ) ) )
		.mul( smoothstep( 0.06, 0.14, above ) ).mul( smoothstep( 0.42, 0.66, above ).oneMinus() ).mul( road ).mul( h.upright ).toConst();
	const polish = cap.mul( smoothstep( 0.35, 0.75, m.smudge ) ).toConst();
	// Rain runs down both faces from the cap, the outer one most.
	const run = streaks( detail, h.station, above, float( 1.1 ).sub( above ) ).mul( h.upright ).mul( road.mul( - 0.45 ).add( 0.85 ) ).toConst();

	let c = color.mul( m.macro.sub( 0.5 ).mul( 0.2 ).add( 0.82 ) );
	c = mix( c, c.mul( vec3( 0.5, 0.48, 0.45 ) ), splash );
	c = mix( c, RUBBER, scuff.mul( 0.8 ) );
	c = mix( c, mix( c, GRIME, 0.5 ), run );
	let r = roughness.add( splash.mul( 0.08 ) );
	r = r.sub( polish.mul( 0.08 ) );
	r = mix( r, r.mul( 0.9 ), scuff );
	r = mix( r, r.mul( 0.82 ), run.mul( 0.5 ) );

	return { color: c, roughness: clamp( r, 0.05, 1 ) };

}

export const HIGHWAY_PROFILES = Object.freeze( {
	'highway-pier': highwayPier, 'highway-soffit': highwaySoffit, 'highway-deck': highwayDeck, 'highway-barrier': highwayBarrier
} );

/** Rows of the graffiti atlas (`cyberpunk/graffiti-atlas/poor`, four 2 x 1 m sheets stacked top to bottom). */
const SHEETS = 4;

/**
 * Graffiti sprayed on a pier's faces: most faces of most piers carry a 2 x 1 m
 * sheet of tags at chest height, a few a second one above it, each face its
 * own sheet, placement and lean, the same on every run. The paint sits on the
 * concrete under the dirt the foot gathers and dulls with it.
 *
 * Reads `_highway_pier` (the owning pier's centre) and the base the pier
 * stands on from `_highway_context`.
 * @param atlas the atlas basecolor (RGBA, its alpha the paint's coverage), unflipped and clamped
 */
export function graffiti( atlas, { color, roughness } ) {

	const h = parts();
	const centre = attribute( '_highway_pier', 'vec2' );
	const n = normalWorldGeometry;
	const local = positionWorld.xz.sub( centre );
	// Across the face, left to right as one faces it.
	const across = local.x.mul( n.z ).sub( local.y.mul( n.x ) );
	const face = mod( floor( atan( n.z, n.x ).div( Math.PI / 2 ).add( 4.5 ) ), 4 );
	const above = positionWorld.y.sub( h.base );
	const pick = hash32( centre.add( face.mul( 17.3 ) ) ).toConst();
	const more = hash32( centre.add( face.mul( 5.9 ).add( 3.7 ) ) ).toConst();
	const band = ( chance, lift, roll, shift ) => {

		const row = floor( roll.mul( SHEETS ) );
		const u = across.add( shift ).mul( 0.5 ).add( 0.5 );
		const v = above.sub( lift ).oneMinus();
		const inside = u.greaterThan( 0 ).and( u.lessThan( 1 ) ).and( v.greaterThan( 0 ) ).and( v.lessThan( 1 ) );
		const paint = texture( atlas, vec2( u.clamp( 0.002, 0.998 ), row.add( v.clamp( 0.01, 0.99 ) ).div( SHEETS ) ) );
		return { rgb: paint.rgb, alpha: select( inside.and( chance ), paint.a, float( 0 ) ) };

	};
	// Chest height on three faces in four, a second sheet higher on one in four.
	const low = band( pick.x.lessThan( 0.75 ), pick.y.mul( 0.5 ).add( 0.35 ), pick.z, more.x.sub( 0.5 ).mul( 0.3 ) );
	const high = band( more.y.lessThan( 0.25 ), pick.y.mul( 0.5 ).add( 1.45 ), fract( pick.z.add( 0.5 ) ), more.z.sub( 0.5 ).mul( 0.4 ) );
	const coverage = max( low.alpha, high.alpha ).mul( h.upright ).mul( 0.95 ).toConst();
	const paint = mix( high.rgb, low.rgb, select( low.alpha.greaterThan( high.alpha ), float( 1 ), float( 0 ) ) );
	// The foot's splash and dirt lie over the paint too.
	const dirt = smoothstep( 0.08, 0.65, above ).oneMinus().mul( 0.45 );
	const sprayed = mix( paint, paint.mul( vec3( 0.55, 0.52, 0.48 ) ), dirt );

	return {
		color: mix( color, sprayed, coverage ),
		roughness: mix( roughness, mix( float( 0.48 ), roughness, dirt ), coverage )
	};

}
