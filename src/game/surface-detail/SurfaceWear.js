import { abs, cameraPosition, clamp, dFdx, dFdy, exp, float, floor, fract, fwidth, max, min, mix, normalWorldGeometry, positionGeometry, positionWorld, select, smoothstep, uv, varying, vec2, vec3 } from 'three/tsl';
import { hash32 } from './SurfaceDetail.js';
import { HIGHWAY_PROFILES } from './HighwayWear.js';

/**
 * Where a city's surfaces are used: world-space wear laid over whatever a
 * material already paints, as nodes.
 *
 * Every profile takes the material's own colour (vec3, linear), roughness
 * (float) and how worn its placement is (`wear`, 0..1, the street's sampled
 * wear field), and answers colour and roughness, worn. The authored maps keep
 * their own roughness response: the layer modulates it (oily smears gloss it
 * down, scuffed rims and dirt dull it up) rather than replacing it. The wear
 * is read at the fragment's world position, so no two slabs, lanes or walls
 * wear the same, and it is the same on every run. It never reads the time.
 *
 * - `road`: city-scale tone, tyre tracks polished and darkened a lane width
 *   apart along the piece's own X (its street), oil dripped between them,
 *   oil stains, tyre marks and cracks placed as artifacts.
 * - `sidewalk`: oily, glossy smears and fingerprints over the slab's own
 *   gloss, each slab its own tone and gloss, rims scuffed and a coating
 *   chipped to the concrete along each slab's frame, grime packed into the
 *   seams and corners, walked lines polished down a walking band, white
 *   paint flecks, gum and stains, and chips of a coated band's own paint on
 *   that band alone.
 * - `curb`: the arris chipped to the concrete under the coating, tyre scuffs
 *   low on the face, grime at the foot.
 * - `gutter`: grit gathering against the curb and standing wet along it.
 * - `joint`: dirt in the seams between slabs.
 * - `paint`: road paint dirtied and polished by the traffic crossing it.
 * - `wall` and `metal`: exterior faces streaked by rain, grimed and splashed
 *   along the base, smudged at hand height, soot at city scale; metal keeps
 *   its colour and takes the smudges harder.
 * - `highway-pier`, `highway-soffit`, `highway-deck`, `highway-barrier`: an
 *   elevated highway's concrete, worn where the structure says ([HighwayWear](HighwayWear.js)).
 */

/** Dark, slightly warm grime (linear). */
const GRIME = vec3( 0.028, 0.025, 0.021 );
/** Dust and de-polish on dark slabs lifts toward a dry grey. */
const DUST = vec3( 0.11, 0.105, 0.098 );
/** The concrete a chipped coating shows (linear). */
const SUBSTRATE = vec3( 0.16, 0.155, 0.148 );
/** Flecks of old white paint. */
const FLECK = vec3( 0.52, 0.51, 0.48 );
/** A lane is 3.5 m and a tyre runs 0.85 m off its centre. */
const LANE = 3.5, TRACK = 0.85;
/** The dirt field read this many times larger is the city-scale variation that hides every repeat. */
const MACRO = 8;
/** Atlas runs, `[row, first column, columns]`: rows are oil and tyre, crack, water, gum and paint chip. */
const OIL = [ 0, 0, 3 ], TYRE = [ 0, 3, 1 ], CRACK = [ 1, 0, 4 ], WATER = [ 2, 0, 4 ], GUM = [ 3, 0, 2 ], CHIP = [ 3, 2, 2 ];

/** Rotates world metres by a fixed angle, so the masks never tile in step with each other. */
function turned( q, angle ) {

	const c = Math.cos( angle ), s = Math.sin( angle );

	return vec2( q.x.mul( c ).sub( q.y.mul( s ) ), q.x.mul( s ).add( q.y.mul( c ) ) );

}

/** The world masks at world metres `q`, each read once; the dirt field twice, at its own scale and at city scale. */
function read( detail, q ) {

	return {
		macro: detail.sample( 'macro', turned( q, 0.61 ).add( 37.1 ), MACRO ).toConst(),
		dirt: detail.sample( 'macro', turned( q, - 0.37 ).add( 11.3 ) ).toConst(),
		smudge: detail.sample( 'smudge', q ).toConst(),
		edge: detail.sample( 'edge', turned( q, - 0.93 ) ).toConst(),
		finger: detail.sample( 'fingerprint', turned( q, 0.29 ) ).toConst()
	};

}

/** A soft bump of `width` around `centre`. */
const bump = ( x, centre, width ) => exp( x.sub( centre ).div( width ).pow( 2 ).negate() );

/** The oily share of a surface: glossy where broad smears and dirt pile up, more of it where the street is worn. */
const oily = ( m, from, to, use ) => smoothstep( from, to, m.smudge.mul( 0.72 ).add( m.macro.mul( 0.34 ) ).add( use.sub( 0.5 ).mul( 0.12 ) ).sub( 0.03 ) );

/** City-scale tone: up to `amount` either way. */
const tone = ( m, amount ) => m.macro.sub( 0.5 ).mul( amount * 2 ).add( 1 );

/** Glosses a roughness down toward a thin oily film, keeping its own variation. */
const gloss = ( r, amount ) => mix( r, r.mul( 0.3 ).add( 0.03 ), amount );

/** Dulls a roughness up toward `to`, keeping its own variation where it is already rougher. */
const dull = ( r, to, amount ) => mix( r, max( r, float( to ) ), amount );

/**
 * Flattened gum: a few dark discs a couple of centimetres across, one cell in
 * `rarity` of a half-metre grid.
 */
function gum( q, rarity ) {

	const g = q.div( 0.5 );
	const h = hash32( floor( g ).add( 91.7 ) ).toConst();
	const centre = h.xy.mul( 0.6 ).add( 0.2 );
	const radius = h.z.mul( 0.025 ).add( 0.022 );
	const d = fract( g ).sub( centre ).length();

	return smoothstep( radius.mul( 0.55 ), radius, d ).oneMinus().mul( select( fract( h.z.mul( 71.3 ) ).lessThan( rarity ), float( 1 ), float( 0 ) ) );

}

/** The dirt line along a panel's own 0..1 UV border, and its corners. */
function seams( width ) {

	const t = uv();
	const edge = min( min( t.x, t.x.oneMinus() ), min( t.y, t.y.oneMinus() ) );
	const blur = max( fwidth( t.x ), fwidth( t.y ) ).mul( 1.5 );
	const line = smoothstep( 0, max( float( width ), blur ), edge ).oneMinus();
	const cx = smoothstep( 0, 0.14, min( t.x, t.x.oneMinus() ) ).oneMinus(), cy = smoothstep( 0, 0.14, min( t.y, t.y.oneMinus() ) ).oneMinus();

	return { line, corner: cx.mul( cy ) };

}

/**
 * Three values in [0, 1) for the slab a fragment lies on: the world corner
 * where its 0..1 UV square starts, found from how position and UV change
 * across the screen and hashed. Positions are taken relative to the camera
 * before they are interpolated, so the corner holds still to a millimetre
 * however far out the city runs.
 */
function slab() {

	const t = uv(), p = varying( positionWorld.sub( cameraPosition ) ).xz;
	const du = dFdx( t ), dv = dFdy( t ), px = dFdx( p ), py = dFdy( p );
	const det = du.x.mul( dv.y ).sub( du.y.mul( dv.x ) );
	const safe = select( abs( det ).greaterThan( 1e-12 ), det, float( 1e-12 ) );
	// p = corner + M t, with M = [px py] [du dv]^-1.
	const mu = px.mul( dv.y ).sub( py.mul( du.y ) ).div( safe );
	const mv = py.mul( du.x ).sub( px.mul( dv.x ) ).div( safe );
	const corner = p.sub( mu.mul( t.x ) ).sub( mv.mul( t.y ) ).add( cameraPosition.xz );

	return hash32( floor( corner.mul( 4 ).add( 0.5 ) ).add( 17.9 ) );

}

/** Stains over a colour and roughness. */
function stained( color, roughness, mark, strength = 1 ) {

	const a = mark.alpha.mul( strength );

	return { color: mix( color, mark.color, a ), roughness: mix( roughness, mark.roughness, a ) };

}

/** Where a road lane's tyres run and where its engines drip, along the piece's own X. */
function lanes( m ) {

	const across = abs( fract( positionGeometry.z.div( LANE ) ).sub( 0.5 ) ).mul( LANE ).toConst();
	const along = m.smudge.mul( 0.45 ).add( 0.55 ).mul( m.macro.mul( 0.5 ).add( 0.5 ) );
	const tracks = bump( across, TRACK, 0.24 ).mul( along ).toConst();
	const drip = bump( across, 0, 0.42 ).mul( smoothstep( 0.55, 0.8, m.smudge.mul( 0.6 ).add( m.edge.mul( 0.4 ) ) ) ).toConst();

	return { tracks, drip };

}

/** How much a placement shows its use: half again more in the street's worn zones, a third less where it is new. */
const usage = ( use ) => use.mul( 0.9 ).add( 0.65 );

export function road( detail, { color, roughness, wear: use = float( 0.4 ) } ) {

	const q = positionWorld.xz;
	const m = read( detail, q );
	const amount = usage( use ).toConst();
	const { tracks, drip } = lanes( m );
	const oil = clamp( max( oily( m, 0.66, 0.92, use ), drip.mul( 0.85 ) ).mul( amount ), 0, 1 ).toConst();

	let c = color.mul( tone( m, 0.14 ) );
	c = c.mul( tracks.mul( 0.2 ).mul( amount ).oneMinus() );
	c = c.mul( oil.mul( 0.45 ).oneMinus() );
	let r = roughness.mul( tone( m, 0.12 ) );
	r = r.mul( tracks.mul( 0.35 ).oneMinus() );
	r = gloss( r, oil.mul( 0.85 ) );
	r = r.add( m.finger.sub( 0.5 ).mul( 0.08 ) );

	let worn = stained( c, r, detail.decal( q, { cell: 3.3, presence: amount.mul( 0.26 ), cells: [ OIL, CRACK, CRACK ], seed: 3 } ), 0.9 );
	worn = stained( worn.color, worn.roughness, detail.decal( q.add( 1.6 ), { cell: 5.1, presence: amount.mul( 0.16 ), cells: [ TYRE, OIL ], seed: 11 } ), 0.75 );

	return { color: worn.color, roughness: clamp( worn.roughness, 0.04, 1 ) };

}

/**
 * @param panel the surface's UV is one 0..1 square per slab, so its border is the seam
 * @param walk the slab is a coated walking band, polished down its middle (V across)
 * @param stains `pavement` (oil, water marks, gum, paint chips) or `drain` (oil and water marks only)
 */
export function sidewalk( detail, { color, roughness, wear: use = float( 0.4 ) }, { panel = true, walk = false, stains = 'pavement' } = {} ) {

	const q = positionWorld.xz;
	const m = read( detail, q );
	const amount = usage( use ).toConst();
	const oil = clamp( oily( m, 0.6, 0.88, use ).mul( amount ), 0, 1 ).toConst();
	const fleck = smoothstep( 0.965, 0.985, m.edge ).mul( smoothstep( 0.45, 0.8, m.macro ) ).toConst();
	const spot = gum( q, use.mul( 0.06 ).add( 0.03 ) ).toConst();

	let c = color.mul( tone( m, 0.12 ) );
	let r = roughness.mul( tone( m, 0.1 ) );

	if ( panel ) {

		// Each slab was poured, or replaced, on its own.
		const own = slab();
		c = c.mul( own.x.sub( 0.5 ).mul( 0.14 ).add( 1 ) );
		r = r.add( own.y.sub( 0.5 ).mul( 0.12 ) );

	}
	if ( walk ) {

		const polish = bump( uv().y, 0.5, 0.26 ).mul( smoothstep( 0.25, 0.75, m.smudge.mul( 0.5 ).add( m.macro.mul( 0.5 ) ) ) ).mul( amount ).toConst();
		r = r.mul( polish.mul( 0.3 ).oneMinus() );
		c = c.mul( polish.mul( 0.08 ).add( 1 ) );

	}
	c = c.mul( oil.mul( 0.32 ).oneMinus() );
	r = gloss( r, oil.mul( 0.9 ) );
	r = r.add( m.finger.sub( 0.5 ).mul( 0.16 ).mul( r.mul( 0.6 ).oneMinus() ) );

	if ( panel ) {

		// The slab's own frame: its rim scuffed and its coating chipped to the
		// concrete under it, then dirt packed into the seam and the corners.
		const seam = seams( 0.022 );
		const t = uv();
		const scuff = detail.frame( 'scuff', t ).mul( m.dirt.mul( 0.6 ).add( 0.4 ) ).mul( amount ).toConst();
		// A coating chips to the concrete under it; bare concrete only scuffs where a chip would be.
		const chip = ( walk ? smoothstep( 0.25, 0.6, detail.frame( 'chips', t ).mul( amount ) ) : smoothstep( 0.5, 0.85, detail.frame( 'chips', t ).mul( amount ) ) ).toConst();
		const breakup = smoothstep( 0.15, 0.65, m.edge.mul( 0.5 ).add( m.dirt.mul( 0.5 ) ) );
		const grime = clamp( seam.line.mul( 0.85 ).add( seam.corner.mul( 0.6 ) ).mul( amount ), 0, 1 ).mul( breakup ).toConst();
		r = dull( r, 0.62, scuff.mul( 0.75 ) );
		c = walk ? mix( c, mix( c, SUBSTRATE, 0.5 ), scuff.mul( 0.6 ) ) : mix( c, max( c, DUST ), scuff.mul( 0.3 ) );
		c = mix( c, walk ? SUBSTRATE : FLECK, chip.mul( walk ? 0.85 : 0.3 ) );
		r = dull( r, 0.78, chip );
		c = mix( c, min( c, GRIME ), grime.mul( 0.8 ) );
		r = dull( r, 0.86, grime.mul( 0.7 ) );

	}
	c = mix( c, FLECK, fleck.mul( 0.6 ) );
	r = dull( r, 0.7, fleck );
	c = mix( c, vec3( 0.035, 0.034, 0.032 ), spot.mul( 0.9 ) );
	r = mix( r, float( 0.55 ), spot );

	// Spills and puddle rims lie a metre or two across; gum and paint chips a
	// hand's width. Only a coated band sheds chips of its coating: bare slabs
	// keep to gum, grime, oil and cracks.
	let worn = stained( c, r, detail.decal( q, { cell: 2.6, presence: amount.mul( 0.2 ), cells: stains === 'drain' ? [ OIL, WATER ] : [ OIL, WATER, WATER ], seed: 5 } ), 0.6 );
	if ( stains !== 'drain' ) worn = stained( worn.color, worn.roughness, detail.decal( q.add( 0.31 ), { cell: 0.45, presence: amount.mul( 0.06 ), cells: walk ? [ GUM, CHIP ] : [ GUM ], seed: 19 } ), 0.85 );

	return { color: worn.color, roughness: clamp( worn.roughness, 0.04, 1 ) };

}

/** The curb band: its top (normal up) runs V 0..1 from the road arris; its face rises in world Y. */
export function curb( detail, { color, roughness, wear: use = float( 0.4 ) } ) {

	const q = positionWorld.xz;
	const m = read( detail, q );
	const amount = usage( use ).toConst();
	const top = normalWorldGeometry.y.greaterThan( 0.5 );
	const y = positionWorld.y;
	const arris = select( top, smoothstep( 0, 0.32, uv().y ).oneMinus(), smoothstep( 0.13, 0.2, y ) ).toConst();
	const foot = select( top, float( 0 ), smoothstep( 0.06, 0.13, y ).oneMinus() ).toConst();
	const chip = arris.mul( smoothstep( 0.52, 0.7, m.edge.mul( amount ) ) ).toConst();
	const scuff = foot.mul( smoothstep( 0.35, 0.7, m.smudge ) ).mul( amount ).toConst();
	const oil = clamp( oily( m, 0.7, 0.95, use ).mul( amount ), 0, 1 ).toConst();

	let c = color.mul( tone( m, 0.12 ) );
	let r = roughness.mul( tone( m, 0.1 ) );
	c = mix( c, SUBSTRATE, chip.mul( 0.9 ) );
	r = dull( r, 0.85, chip );
	c = mix( c, c.mul( 0.3 ), clamp( scuff, 0, 1 ).mul( 0.85 ) );
	r = mix( r, float( 0.5 ), clamp( scuff, 0, 1 ) );
	c = mix( c, min( c, GRIME ), foot.mul( m.dirt.mul( 0.5 ).add( 0.3 ) ) );
	c = c.mul( oil.mul( 0.3 ).oneMinus() );
	r = gloss( r, oil );
	r = r.add( m.finger.sub( 0.5 ).mul( 0.12 ) );

	return { color: c, roughness: clamp( r, 0.04, 1 ) };

}

/** The gutter band runs V 0..1 from the road edge up to the curb's foot. */
export function gutter( detail, { color, roughness, wear: use = float( 0.4 ) } ) {

	const q = positionWorld.xz;
	const m = read( detail, q );
	const amount = usage( use ).toConst();
	const grime = clamp( smoothstep( 0.35, 1, uv().y ).mul( 0.7 ).add( 0.3 ).mul( amount ), 0, 1 ).mul( smoothstep( 0.1, 0.7, m.dirt.mul( 0.5 ).add( m.edge.mul( 0.5 ) ) ) ).toConst();
	const wet = smoothstep( 0.62, 0.86, m.smudge.mul( 0.55 ).add( m.macro.mul( 0.45 ) ) ).mul( smoothstep( 0.2, 0.9, uv().y ) ).toConst();

	let c = color.mul( tone( m, 0.1 ) );
	c = mix( c, min( c, GRIME ), grime.mul( 0.75 ) );
	c = c.mul( wet.mul( 0.35 ).oneMinus() );
	let r = dull( roughness.mul( tone( m, 0.1 ) ), 0.85, grime.mul( 0.5 ) );
	r = mix( r, float( 0.06 ), wet.mul( 0.85 ) );

	const worn = stained( c, r, detail.decal( q, { cell: 2.2, presence: amount.mul( 0.2 ), cells: [ OIL, GUM ], seed: 7 } ) );

	return { color: worn.color, roughness: clamp( worn.roughness, 0.04, 1 ) };

}

export function joint( detail, { color, roughness } ) {

	const m = read( detail, positionWorld.xz );
	const c = mix( color.mul( tone( m, 0.2 ) ), GRIME, smoothstep( 0.3, 0.8, m.dirt ).mul( 0.6 ) );

	return { color: c, roughness: clamp( roughness.add( m.macro.sub( 0.5 ).mul( 0.1 ) ), 0.04, 1 ) };

}

export function paint( detail, { color, roughness, wear: use = float( 0.4 ) } ) {

	const m = read( detail, positionWorld.xz );
	const amount = usage( use );
	const { tracks } = lanes( m );
	let c = color.mul( tone( m, 0.1 ) );
	c = c.mul( tracks.mul( 0.35 ).mul( amount ).oneMinus() );
	c = mix( c, c.mul( 0.6 ), smoothstep( 0.55, 0.9, m.smudge ).mul( 0.5 ) );
	const r = mix( roughness.add( m.edge.sub( 0.5 ).mul( 0.14 ) ), roughness.mul( 0.6 ), tracks );

	return { color: c, roughness: clamp( r, 0.04, 1 ) };

}

/**
 * An exterior face: its wear is read on the plane it faces (a wall on its
 * horizontal run and height, a roof or ledge on the ground plane) and the
 * city stands on flat ground at height 0. A kept building (`kept`, the rich
 * tiers) shows half the streaks, grime and smudges of a poor one and no stains.
 */
function facade( detail, { color, roughness }, { metal, kept } ) {

	const n = normalWorldGeometry;
	const p = positionWorld;
	const upright = abs( n.y ).lessThan( 0.6 );
	const run = select( abs( n.x ).greaterThan( abs( n.z ) ), p.z, p.x );
	const q = select( upright, vec2( run, p.y ), p.xz ).toConst();
	const m = read( detail, q );
	const height = p.y.sub( 0.2 );

	// Rain runs down a face in narrow streaks, longer than the mask's repeat.
	const streak = detail.sample( 'streaks', vec2( run, p.y.mul( 0.45 ) ).add( 5.3 ) );
	const streaks = smoothstep( 0.5, 0.88, streak ).mul( smoothstep( 0.2, 0.65, m.macro ) ).mul( select( upright, float( 1 ), float( 0 ) ) ).toConst();
	// The base splashes and gathers dirt, deepest in the first half metre, its
	// top edge rising and falling slowly along the wall.
	const base = smoothstep( 0.05, 1.1, height.add( m.macro.sub( 0.5 ).mul( 0.7 ) ).add( m.dirt.sub( 0.5 ).mul( 0.15 ) ) ).oneMinus()
		.mul( select( upright, float( 1 ), float( 0.4 ) ) ).toConst();
	// Hands reach a face between knee and head height.
	const reach = bump( height, 1.25, 0.55 ).mul( select( upright, float( 1 ), float( 0 ) ) ).mul( smoothstep( 0.45, 0.85, m.finger ) ).toConst();
	const oil = oily( m, 0.68, 0.92, float( 0.5 ) ).toConst();
	const k = kept ? 0.5 : 1;

	let c = color.mul( tone( m, metal ? 0.06 : 0.14 ) );
	c = c.mul( streaks.mul( ( metal ? 0.2 : 0.42 ) * k ).oneMinus() );
	c = mix( c, c.mul( vec3( 0.42, 0.38, 0.33 ) ), base.mul( 0.8 * k ) );
	c = mix( c, c.mul( 0.82 ), smoothstep( 0.72, 0.95, m.edge ).mul( ( metal ? 0.25 : 0.4 ) * k ) );

	// Smudges move a face's own gloss in proportion to it, so a polished panel
	// is smeared, not spotted; only hands and oil move it far.
	let r = roughness.mul( tone( m, 0.08 ) ).mul( smoothstep( 0.2, 0.8, m.smudge ).sub( 0.5 ).mul( ( metal ? 0.3 : 0.24 ) * k ).add( 1 ) );
	r = mix( r, r.mul( 0.8 ), streaks.mul( 0.5 * k ) );
	r = dull( r, 0.88, base.mul( 0.45 * k ) );
	r = mix( r, r.mul( 0.5 ).add( 0.05 ), reach.mul( ( metal ? 0.6 : 0.4 ) * k ) );
	r = gloss( r, oil.mul( ( metal ? 0.3 : 0.2 ) * k ) );
	r = r.mul( m.finger.sub( 0.5 ).mul( ( metal ? 0.24 : 0.12 ) * k ).add( 1 ) );

	// A kept face carries no stains; a poor one cracks here and there.
	if ( kept ) return { color: c, roughness: clamp( r, 0.04, 1 ) };
	const mark = detail.decal( q, { cell: 2.9, presence: 0.16, cells: [ CRACK ], seed: 13 } );
	const worn = stained( c, r, { ...mark, alpha: mark.alpha.mul( select( upright, float( 1 ), float( 0.5 ) ) ) }, metal ? 0.3 : 0.55 );

	return { color: worn.color, roughness: clamp( worn.roughness, 0.04, 1 ) };

}

export const wall = ( detail, surface ) => facade( detail, surface, { metal: false, kept: false } );
export const metal = ( detail, surface ) => facade( detail, surface, { metal: true, kept: false } );
export const keptWall = ( detail, surface ) => facade( detail, surface, { metal: false, kept: true } );
export const keptMetal = ( detail, surface ) => facade( detail, surface, { metal: true, kept: true } );

export const PROFILES = Object.freeze( { road, sidewalk, curb, gutter, joint, paint, wall, metal, 'kept-wall': keptWall, 'kept-metal': keptMetal, ...HIGHWAY_PROFILES } );
