/*
 * Carried over from the NPC Studio (codex_npcs, src/clothing/materials.js and
 * src/clothing/variant-materials.js): the garments' continuous colour panels,
 * seams, trims and fabric finishes.
 */
import { Color, DoubleSide, MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, float, Fn, fwidth, mix, smoothstep, uniform } from 'three/tsl';
import { garmentWear, textileNormal, textileResponse } from './GarmentTextiles.js';

export const FABRIC_FINISHES = {
	tech: { roughness: 0.64, metalness: 0, grain: 0.035 },
	woven: { roughness: 0.82, metalness: 0, grain: 0.055 },
	leather: { roughness: 0.5, metalness: 0, grain: 0.025 }
};
const PANELS = [ 'primary', 'secondary', 'accent', 'trim' ];
/**
 * Each panel material's uniforms. Not on userData: a material copied (the
 * room lighting wears copies) takes its userData as JSON, and its copy paints
 * with these same uniforms anyway.
 */
const CONTROLS = new WeakMap();
const DEFAULT_COLORS = [ '#202c3b', '#536377', '#a9bcb7', '#10151d' ];

/**
 * One opaque, GPU-skinned draw per garment. Panel edges are evaluated per
 * fragment in the finished shell's rest coordinates, so neither the
 * triangulation nor a pose turns a straight stitched edge into a row of
 * coloured teeth. Colours and fabric are uniforms: dressing another person in
 * the same garment rebuilds nothing and compiles nothing. A small shared
 * textile atlas provides mipmapped dye, roughness and yarn relief; there is
 * no frame callback. The garment's cut picks its panels once at construction.
 *
 * @param worn when given, `worn(object)` is the panels (`panelsFor`) of the
 *   mesh being drawn, read per draw: one material then dresses everybody
 *   wearing the garment, each in their own colours
 */
export function createPanelMaterial( id, palette = null, fabric = 'tech', { worn = null } = {} ) {

	const material = new MeshStandardNodeMaterial( { side: DoubleSide } );
	material.name = `fabric-${id}`;
	const controls = {
		palette: DEFAULT_COLORS.map( ( value ) => uniform( new Color( value ) ) ),
		roughness: uniform( 0.66 ),
		metalness: uniform( 0.035 ),
		grain: uniform( 0.014 ),
		fabric: uniform( 0 )
	};
	if ( worn ) {

		controls.palette.forEach( ( node, index ) => node.onObjectUpdate( ( { object } ) => worn( object )?.palette[ index ] ) );
		for ( const key of [ 'roughness', 'metalness', 'grain', 'fabric' ] ) controls[ key ].onObjectUpdate( ( { object } ) => worn( object )?.[ key ] );

	}
	material.userData.garment = id;
	CONTROLS.set( material, controls );
	const textile = textileResponse( id, controls.fabric );
	const surface = attribute( 'garmentSurface', 'vec3' );
	const shares = attribute( 'garmentShares', 'vec4' );
	const wear = garmentWear( id, surface, shares );
	const footwear = /^(boots|shoes|sneakers)-/.test( id );
	const sole = footwear ? smoothstep( 0.022, 0.03, surface.y ).oneMinus() : float( 0 );
	const construction = constructionHeight( id, surface, shares );

	material.colorNode = Fn( () => {

		const p = attribute( 'garmentSurface', 'vec3' ).toVar();
		const n = attribute( 'garmentNormal', 'vec3' ).normalize().toVar();
		const shares = attribute( 'garmentShares', 'vec4' ).toVar();
		const rim = shares.w;
		const ax = p.x.abs().toVar();
		const front = smoothstep( 0.12, 0.58, n.z ).toVar();
		const back = smoothstep( 0.12, 0.58, n.z.negate() ).toVar();
		const outer = n.x.mul( p.x.sign() ).toVar();
		const arm = smoothstep( 0.28, 0.72, shares.y ).toVar();
		const neck = smoothstep( 0.16, 0.58, shares.z ).toVar();
		const body = arm.oneMinus().mul( neck.oneMinus() ).toVar();
		const [ primary, secondary, accent, trim ] = controls.palette;
		const out = primary.toVar();
		const paint = ( mask, color, strength = 1 ) => {

			out.assign( mix( out, color, mask.mul( strength ).clamp( 0, 1 ) ) );

		};
		const chest = front.mul( body ).toVar();
		const side = smoothstep( 0.3, 0.75, outer ).toVar();
		const context = {
			p, n, ax, front, back, outer, arm, neck, body, chest, side,
			primary, secondary, accent, trim, paint, above, below, band, line, circle, periodicLine
		};

		if ( id === 'tech-top' ) paintTechTop( context );
		else if ( id === 'police-jacket' ) paintPoliceJacket( context );
		else if ( id === 'office-jacket' ) paintOfficeJacket( context );
		else if ( id === 'pants-tech' ) paintTechTrousers( context );
		else if ( id === 'pants-patrol' ) paintPatrolTrousers( context );
		else if ( id === 'pants-office' ) paintOfficeTrousers( context );
		else if ( id === 'boots-patrol' ) paintPatrolBoots( context );
		else if ( id === 'shoes-city' ) paintCityShoes( context );
		else paintVariantPanels( id, context );

		// Mipmapped yarn detail integrates at distance. Contact wear also polishes
		// the response below, instead of just painting dirt over the whole outfit.
		out.mulAssign( textile.r.sub( 0.5 ).mul( controls.grain.mul( 4 ) ).add( 1 ) );
		out.mulAssign( mix( float( 1 ), textile.a, float( 0.4 ) ) );
		out.assign( mix( out, out.mul( 1.15 ).add( 0.004 ), wear.mul( 0.35 ) ) );
		paint( rim, trim );
		return out;

	} )();

	material.roughnessNode = Fn( () => {

		const fabric = id === 'pants-leggings'
			? mix( controls.roughness, float( 0.36 ), controls.fabric.equal( 0 ) ) : controls.roughness;
		const base = footwear ? float( id.startsWith( 'sneakers-' ) ? 0.76 : id === 'shoes-city' ? 0.38 : 0.51 ) : fabric;
		return mix( base.add( textile.g.sub( 0.5 ).mul( 0.28 ) ).sub( wear.mul( 0.07 ) ), float( 0.94 ), sole ).clamp( 0.24, 0.98 );

	} )();
	material.metalnessNode = controls.metalness;
	const yarnHeight = footwear ? float( id.startsWith( 'sneakers-' ) ? 0.0001 : 0.00005 )
		: mix( float( 0.0001 ), float( 0.000045 ), controls.fabric.equal( 2 ) );
	material.normalNode = textileNormal( textile.b.mul( yarnHeight ).mul( sole.oneMinus() ).add( construction ) );
	updatePanelMaterial( material, palette, fabric );
	return material;

}

/**
 * A garment's colours and finish as its panels paint them: `{ palette, roughness,
 * metalness, grain }`, the palette its primary, secondary, accent and trim.
 *
 * @param palette `{ primary, secondary, accent }` or four colours; the trim is
 *   the primary deepened when none is given
 */
export function panelsFor( palette, fabric = 'tech' ) {

	const colors = PANELS.map( ( panel, index ) => palette?.[ index ] ?? palette?.[ panel ] );
	const finish = typeof fabric === 'string' ? ( FABRIC_FINISHES[ fabric ] ?? FABRIC_FINISHES.tech ) : fabric;
	const roughness = finish?.roughness ?? FABRIC_FINISHES.tech.roughness;
	return {
		palette: PANELS.map( ( _, index ) => index === 3 && colors[ 3 ] === undefined
			? new Color( colors[ 0 ] ?? DEFAULT_COLORS[ 0 ] ).multiplyScalar( 0.42 )
			: new Color( colors[ index ] ?? DEFAULT_COLORS[ index ] ) ),
		roughness,
		metalness: finish?.metalness ?? FABRIC_FINISHES.tech.metalness,
		grain: finish?.grain ?? ( roughness > 0.8 ? 0.055 : 0.035 ),
		fabric: fabric === 'woven' ? 1 : fabric === 'leather' ? 2 : 0
	};

}

/** Writes a garment's colours and fabric into its material's own uniforms. */
export function updatePanelMaterial( material, palette, fabric = 'tech' ) {

	const controls = CONTROLS.get( material );
	if ( ! controls ) return;
	const panels = panelsFor( palette, fabric );
	panels.palette.forEach( ( color, index ) => controls.palette[ index ].value.copy( color ) );
	controls.roughness.value = panels.roughness;
	controls.metalness.value = panels.metalness;
	controls.grain.value = panels.grain;
	controls.fabric.value = panels.fabric;
	// Plain material reads (inspection, copies) see the same finish.
	material.roughness = panels.roughness;
	material.metalness = panels.metalness;

}

function paintTechTop( { p, ax, arm, neck, body, chest, back, secondary, accent, trim, paint } ) {

	const yokeLine = ax.mul( 0.3 ).add( 0.764 ).toVar();
	const yoke = above( p.y, yokeLine ).mul( body );
	const flank = above( ax, p.y.sub( 0.63 ).mul( 0.12 ).add( 0.054 ) ).mul( body );
	paint( yoke.max( flank.mul( 0.85 ) ), secondary, 0.86 );
	paint( arm.mul( band( ax, 0.235, 0.324 ) ), secondary, 0.8 );
	paint( arm.mul( band( ax, 0.148, 0.183 ) ), secondary, 0.65 );
	paint( below( p.y, 0.587 ).mul( body ), trim );
	paint( neck, trim );
	paint( arm.mul( above( ax, 0.326 ) ), trim );
	// A narrow closure and fine yoke piping, no broad luminous racing stripes.
	paint( line( p.x, 0.0025 ).mul( chest ).mul( above( p.y, 0.595 ) ), trim );
	paint( line( p.x, 0.0008 ).mul( chest ).mul( band( p.y, 0.608, 0.84 ) ), accent, 0.85 );
	paint( line( p.y.sub( yokeLine ), 0.0009 ).mul( chest ).mul( band( ax, 0.028, 0.108 ) ), accent, 0.6 );
	paint( line( p.y.sub( yokeLine ).add( 0.006 ), 0.00055 ).mul( body ), trim, 0.5 );
	paint( line( ax.sub( 0.325 ), 0.001 ).mul( arm ), accent, 0.65 );
	paint( line( p.x, 0.0012 ).mul( back ).mul( band( p.y, 0.625, 0.771 ) ), trim, 0.7 );
	// A small zip pull makes the central fastening legible at close range.
	paint( band( p.x, - 0.0026, 0.0026 ).mul( band( p.y, 0.797, 0.807 ) ).mul( chest ), accent );

}

function paintPoliceJacket( { p, ax, arm, neck, body, chest, back, side, secondary, accent, trim, paint } ) {

	// The body and sleeves remain separate layers even in subdued work colours.
	paint( arm, secondary, 0.86 );
	const shoulder = above( p.y, ax.mul( 0.12 ).add( 0.789 ) ).mul( body );
	paint( shoulder, secondary, 0.7 );
	paint( arm.mul( below( ax, 0.184 ) ), secondary, 0.65 );
	paint( arm.mul( band( ax, 0.248, 0.323 ) ), secondary, 0.4 );
	paint( side.mul( body ), trim, 0.33 );
	paint( neck, trim );
	paint( below( p.y, 0.567 ).mul( body ), trim );
	paint( arm.mul( above( ax, 0.326 ) ), trim );
	paint( line( ax.sub( 0.328 ), 0.0011 ).mul( arm ), accent, 0.65 );
	paint( line( p.y.sub( 0.865 ), 0.001 ).mul( neck ), accent, 0.6 );
	// Paired chest pockets with straight flaps and a narrow offset closure.
	const pocket = band( ax, 0.028, 0.077 ).mul( band( p.y, 0.699, 0.755 ) ).mul( chest );
	paint( pocket, secondary, 0.65 );
	paint( band( ax, 0.026, 0.079 ).mul( band( p.y, 0.744, 0.756 ) ).mul( chest ), trim, 0.9 );
	paint( line( p.y.sub( 0.743 ), 0.00065 ).mul( band( ax, 0.032, 0.073 ) ).mul( chest ), accent, 0.45 );
	paint( band( p.x, 0.007, 0.014 ).mul( chest ).mul( band( p.y, 0.572, 0.85 ) ), trim );
	paint( line( p.x.sub( 0.0095 ), 0.00055 ).mul( chest ).mul( band( p.y, 0.598, 0.818 ) ), secondary );
	// A subdued rectangular insignia with a small metallic fastener.
	paint( band( p.x, 0.039, 0.06 ).mul( band( p.y, 0.77, 0.783 ) ).mul( chest ), accent, 0.8 );
	paint( band( p.x, - 0.06, - 0.032 ).mul( band( p.y, 0.775, 0.779 ) ).mul( chest ), accent, 0.65 );
	paint( band( p.y, 0.765, 0.785 ).mul( band( ax, 0.013, 0.073 ) ).mul( back ), trim, 0.8 );

}

function paintOfficeJacket( { p, ax, arm, neck, body, chest, front, back, side, secondary, accent, trim, paint } ) {

	const opening = smoothstep( 0.659, 0.825, p.y ).mul( 0.046 ).add( 0.01 ).toVar();
	const shirt = below( ax, opening ).mul( above( p.y, 0.666 ) ).mul( chest ).toVar();
	const lapel = band( ax.sub( opening ), - 0.001, 0.018 ).mul( band( p.y, 0.687, 0.835 ) ).mul( chest ).toVar();
	paint( side.mul( body ), trim, 0.18 );
	paint( shirt, secondary );
	// Turned lapels stay one clean plane around the inner blouse.
	paint( lapel, trim, 0.85 );
	paint( line( ax.sub( opening ).sub( 0.017 ), 0.00065 ).mul( band( p.y, 0.702, 0.825 ) ).mul( chest ), secondary, 0.38 );
	paint( neck, secondary );
	paint( arm.mul( above( ax, 0.278 ) ), trim, 0.85 );
	paint( arm.mul( above( ax, 0.287 ) ), secondary );
	paint( line( ax.sub( 0.278 ), 0.00065 ).mul( arm ), secondary, 0.48 );
	paint( band( p.x, 0.044, 0.08 ).mul( band( p.y, 0.742, 0.746 ) ).mul( chest ), trim );
	paint( line( p.y.sub( 0.746 ), 0.00055 ).mul( band( p.x, 0.046, 0.079 ) ).mul( chest ), secondary, 0.4 );
	paint( band( ax, 0.052, 0.087 ).mul( band( p.y, 0.619, 0.623 ) ).mul( chest ), trim, 0.65 );
	paint( line( p.x, 0.001 ).mul( band( p.y, 0.564, 0.643 ) ).mul( front.max( back ) ), trim, 0.55 );
	paint( circle( p.x, p.y.sub( 0.653 ), 0.0024 ).mul( chest ), accent );
	paint( circle( p.x, p.y.sub( 0.62 ), 0.0024 ).mul( chest ), accent );
	// The inner shirt has a quiet central placket.
	paint( line( p.x, 0.0007 ).mul( shirt ), trim, 0.13 );

}

function paintTechTrousers( { p, front, outer, side, secondary, accent, trim, paint } ) {

	// The lateral inset eases into one continuous seat panel instead of
	// outlining the seat's fold with a contrasting contour.
	const leg = smoothstep( 0.478, 0.515, p.y ).oneMinus().toVar();
	paint( side.mul( leg ), secondary, 0.48 );
	paint( band( p.y, 0.254, 0.332 ).mul( front ), secondary, 0.45 );
	paint( above( p.y, 0.602 ), trim, 0.8 );
	paint( below( p.y, 0.081 ), trim, 0.8 );
	paint( line( p.y.sub( 0.32 ), 0.0009 ).mul( front ).mul( below( outer.abs(), 0.75 ) ), trim, 0.7 );
	paint( line( outer.sub( 0.66 ), 0.026 ).mul( band( p.y, 0.13, 0.518 ) ).mul( leg ), trim, 0.5 );
	paint( band( outer, 0.77, 0.95 ).mul( band( p.y, 0.444, 0.455 ) ), accent, 0.65 );
	paint( line( p.y.sub( 0.602 ), 0.0008 ), secondary, 0.55 );
	paint( line( p.x, 0.0011 ).mul( front ).mul( band( p.y, 0.508, 0.602 ) ), trim, 0.65 );

}

function paintPatrolTrousers( { p, front, side, secondary, accent, trim, paint } ) {

	const pocket = side.mul( band( p.y, 0.365, 0.475 ) ).toVar();
	paint( pocket, secondary, 0.58 );
	paint( side.mul( band( p.y, 0.461, 0.477 ) ), trim, 0.8 );
	paint( line( p.y.sub( 0.46 ), 0.0009 ).mul( side ), secondary );
	paint( band( p.y, 0.255, 0.333 ).mul( front ), secondary, 0.45 );
	paint( line( p.y.sub( 0.329 ), 0.001 ).mul( front ), trim, 0.65 );
	paint( side.mul( band( p.y, 0.13, 0.24 ) ), secondary, 0.3 );
	paint( above( p.y, 0.602 ), trim );
	paint( below( p.y, 0.082 ), trim );
	paint( side.mul( band( p.y, 0.449, 0.455 ) ), accent, 0.45 );
	paint( line( p.x, 0.0013 ).mul( front ).mul( band( p.y, 0.511, 0.602 ) ), trim, 0.65 );
	paint( band( p.x, - 0.014, 0.014 ).mul( band( p.y, 0.608, 0.623 ) ).mul( front ), secondary, 0.8 );

}

function paintOfficeTrousers( { p, n, front, back, outer, secondary, accent, trim, paint } ) {

	paint( above( p.y, 0.607 ), trim, 0.8 );
	paint( line( p.y.sub( 0.607 ), 0.0008 ), secondary, 0.28 );
	paint( smoothstep( 0.79, 0.98, outer ), trim, 0.22 );
	// Fine pinstripes fade out below pixel size instead of shimmering.
	const stripe = periodicLine( p.x.mul( 174 ), 0.035 ).mul( below( p.y, 0.601 ) );
	paint( stripe, secondary, 0.11 );
	const crease = line( n.x, 0.025 ).mul( front.max( back ) ).mul( band( p.y, 0.092, 0.497 ) );
	paint( crease, secondary, 0.17 );
	paint( line( p.x, 0.001 ).mul( front ).mul( band( p.y, 0.509, 0.607 ) ), trim, 0.7 );
	paint( band( p.x, - 0.009, 0.009 ).mul( band( p.y, 0.613, 0.623 ) ).mul( front ), accent, 0.6 );
	paint( line( p.y.sub( 0.079 ), 0.001 ), trim, 0.6 );

}

function paintPatrolBoots( { p, front, outer, side, secondary, accent, trim, paint } ) {

	paint( front.mul( band( p.y, 0.06, 0.153 ) ), secondary, 0.42 );
	paint( above( p.z, 0.029 ).mul( below( p.y, 0.064 ) ), secondary, 0.38 );
	paint( above( p.y, 0.173 ), trim, 0.9 );
	paint( band( p.y, 0.148, 0.162 ), trim, 0.7 );
	paint( side.mul( band( p.y, 0.15, 0.156 ) ), accent, 0.5 );
	paint( below( p.y, 0.02 ), trim );
	paint( line( p.y.sub( 0.023 ), 0.001 ), secondary, 0.55 );
	paint( line( p.z.sub( 0.029 ), 0.001 ).mul( below( p.y, 0.064 ) ), trim, 0.8 );
	paint( line( outer.sub( 0.78 ), 0.024 ).mul( band( p.y, 0.046, 0.142 ) ), trim, 0.5 );

}

function paintCityShoes( { p, n, side, secondary, accent, trim, paint } ) {

	paint( above( p.z, 0.034 ), secondary, 0.27 );
	paint( above( p.y, 0.062 ), trim, 0.7 );
	paint( band( p.y, 0.012, 0.019 ), secondary, 0.55 );
	paint( below( p.y, 0.012 ), trim );
	paint( line( p.z.sub( 0.034 ), 0.0009 ).mul( above( p.y, 0.018 ) ), trim, 0.58 );
	// A discreet vamp strap rather than a bright patch across the shoe.
	const vamp = band( p.z, - 0.012, 0.003 ).mul( smoothstep( 0.32, 0.75, n.y ) );
	paint( vamp, trim, 0.75 );
	paint( line( p.z.sub( 0.002 ), 0.0008 ).mul( smoothstep( 0.32, 0.75, n.y ) ), secondary, 0.55 );
	paint( side.mul( band( p.z, - 0.006, 0.002 ) ).mul( band( p.y, 0.038, 0.046 ) ), accent, 0.4 );

}

/**
 * What a panel material paints with now: its four panel colours, linear, and
 * its fabric's roughness and metalness; null for any other material.
 */
export function panelsOf( material ) {

	const controls = CONTROLS.get( material );
	if ( ! controls ) return null;
	const [ primary, secondary, accent, trim ] = controls.palette.map( ( node ) => node.value );
	return { primary, secondary, accent, trim, roughness: controls.roughness.value, metalness: controls.metalness.value };

}

// Profiles pick the shader's construction once, when a garment's material is made.
const TOP_PROFILES = {
	'top-tee': { family: 'knit', hem: 0.568, collar: 0.831, cuff: 0.198, end: 0.215, yoke: 0.782 },
	'top-tank': { family: 'knit', hem: 0.568, collar: 0.825, sleeveless: true },
	'top-turtleneck': { family: 'knit', hem: 0.573, collar: 0.842, cuff: 0.323, end: 0.349, yoke: 0.794, tallNeck: true },
	'jacket-cropped': { family: 'jacket', hem: 0.635, rib: 0.648, cuff: 0.277, end: 0.3, yoke: 0.8, pocket: 0.7 },
	'jacket-bomber': { family: 'jacket', hem: 0.605, rib: 0.635, cuff: 0.323, end: 0.349, yoke: 0.794, pocket: 0.673, bomber: true },
	'vest-tailored': { family: 'tailored', hem: 0.576, vest: true },
	'shirt-utility': { family: 'tailored', hem: 0.547, cuff: 0.263, end: 0.286 }
};
const TROUSER_PROFILES = {
	'pants-leggings': { family: 'stretch', waist: 0.603, hem: 0.063, cuff: 0.085 },
	'pants-chinos': { family: 'tailored', waist: 0.602, hem: 0.08, cuff: 0.11 },
	'pants-cargo': { family: 'utility', waist: 0.602, hem: 0.063, cuff: 0.083, pocket: [ 0.365, 0.465 ] },
	'pants-shorts': { family: 'utility', waist: 0.602, hem: 0.355, cuff: 0.385, pocket: [ 0.441, 0.516 ], short: true },
	'pants-joggers': { family: 'stretch', waist: 0.602, hem: 0.066, cuff: 0.102, jogger: true }
};
const SHOE_PROFILES = {
	'sneakers-low': { family: 'sneaker', top: 0.094 },
	'sneakers-high': { family: 'sneaker', top: 0.151, high: true },
	'boots-chelsea': { family: 'boot', top: 0.143 },
	'boots-tall': { family: 'boot', top: 0.287, tall: true }
};

function paintVariantPanels( id, context ) {

	const top = TOP_PROFILES[ id ];
	if ( top ) {

		if ( top.family === 'knit' ) paintKnitTop( top, context );
		else if ( top.family === 'jacket' ) paintJacket( top, context );
		else paintTailoredTop( top, context );
		return;

	}
	const pants = TROUSER_PROFILES[ id ];
	if ( pants ) {

		paintTrousers( pants, context );
		return;

	}
	const shoes = SHOE_PROFILES[ id ];
	if ( shoes?.family === 'sneaker' ) paintSneakers( shoes, context );
	else if ( shoes ) paintBoots( shoes, context );

}

function paintKnitTop( profile, { p, ax, arm, neck, body, chest, back, side, primary, secondary, accent, trim, paint } ) {

	if ( profile.sleeveless ) {

		// Printed cotton: brick/red colourways carry diagonal stripes. Pale
		// colourways keep a small back print instead of sharing the same uniform.
		const red = smoothstep( 0.025, 0.16, primary.r.sub( primary.b ) );
		const stripes = periodicLine( p.y.add( p.x.mul( 0.65 ) ).mul( 21 ), 0.19 )
			.mul( body ).mul( band( p.y, profile.hem + 0.018, 0.803 ) ).mul( chest.max( back ) );
		paint( stripes, trim, red.mul( 0.78 ) );
		const pale = smoothstep( 0.16, 0.55, primary.r.add( primary.g ).add( primary.b ).div( 3 ) );
		const print = band( ax, 0.023, 0.033 ).mul( band( p.y, 0.725, 0.792 ) )
			.max( band( p.x, - 0.036, 0.026 ).mul( band( p.y, 0.745, 0.754 ) ) )
			.max( band( p.x, - 0.013, 0.036 ).mul( band( p.y, 0.771, 0.781 ) ) ).mul( back );
		paint( print, secondary, pale.mul( 0.88 ) );
		// Continuous side inserts and bound armholes mark the athletic tank.
		paint( above( ax, 0.06 ).mul( body ), secondary, 0.9 );
		paint( band( ax, 0.093, 0.108 ).mul( arm.max( side.mul( above( p.y, 0.75 ) ) ) ), accent );
		paint( above( p.y, profile.collar ).mul( below( ax, 0.067 ) ), accent );
		paint( band( p.y, profile.hem + 0.007, profile.hem + 0.017 ), accent, 0.85 );

	} else {

		const yoke = above( p.y, ax.mul( 0.1 ).add( profile.yoke ) ).mul( body );
		paint( yoke, secondary, 0.85 );
		paint( arm.mul( below( ax, profile.cuff ) ), secondary, profile.tallNeck ? 0.35 : 0.9 );
		paint( arm.mul( band( ax, profile.cuff, profile.end ) ), accent );
		paint( above( p.y, profile.collar ).mul( body.max( neck ) ), secondary );
		paint( band( p.y, profile.collar, profile.collar + 0.01 ).mul( body.max( neck ) ), accent );
		// A small fabric chest label reads at portrait distance with no decal draw.
		paint( band( p.x, 0.034, 0.058 ).mul( band( p.y, 0.748, 0.759 ) ).mul( chest ), accent );
		if ( profile.tallNeck ) {

			paint( above( p.y, 0.875 ), accent );
			paint( side.mul( body ).mul( band( p.y, 0.602, 0.773 ) ), secondary, 0.7 );
			paint( line( p.y.sub( 0.865 ), 0.0008 ), trim, 0.5 );

		}

	}
	paint( band( p.y, profile.hem, profile.hem + 0.006 ).mul( body ), trim, 0.75 );
	paint( line( p.y.sub( profile.hem + 0.006 ), 0.0007 ).mul( body ), secondary, 0.65 );

}

function paintJacket( profile, { p, ax, arm, neck, body, chest, back, front, side, primary, secondary, accent, trim, paint } ) {

	if ( profile.bomber ) {

		const chevron = periodicLine( p.y.mul( 62 ).add( p.x.mul( 46 ).fract().sub( 0.5 ).abs() ), 0.15 );
		const printed = smoothstep( 0.025, 0.1, primary.b.sub( primary.r ) )
			.mul( smoothstep( 0.1, 0.28, secondary.g.sub( primary.g ) ) );
		paint( chevron.mul( body ).mul( band( p.y, profile.rib + 0.012, profile.yoke ) ), secondary, printed.mul( 0.24 ) );

	}
	const yokeLine = ax.mul( 0.12 ).add( profile.yoke ).toVar();
	paint( above( p.y, yokeLine ).mul( body ), secondary, 0.9 );
	paint( side.mul( body ), secondary, 0.5 );
	paint( arm.mul( band( ax, 0.139, 0.18 ) ), secondary, 0.8 );
	const rib = below( p.y, profile.rib ).mul( body ).max( neck ).max( arm.mul( above( ax, profile.cuff ) ) ).toVar();
	paint( rib, secondary );
	paint( band( p.y, profile.hem + 0.004, profile.hem + 0.009 ).mul( body ), accent );
	paint( arm.mul( band( ax, profile.cuff + 0.004, profile.cuff + 0.009 ) ), accent );
	paint( line( p.x, 0.003 ).mul( chest ).mul( above( p.y, profile.rib ) ), trim );
	paint( line( p.x, 0.001 ).mul( chest ).mul( band( p.y, profile.rib + 0.006, 0.837 ) ), accent, 0.85 );
	const pocketLine = ax.mul( 0.28 ).add( profile.pocket ).toVar();
	const pocket = band( ax, 0.042, 0.081 ).mul( line( p.y.sub( pocketLine ), 0.005 ) ).mul( chest );
	paint( pocket, trim );
	paint( band( ax, 0.044, 0.079 ).mul( line( p.y.sub( pocketLine ).sub( 0.004 ), 0.0014 ) ).mul( chest ), accent );
	paint( band( p.x, - 0.003, 0.003 ).mul( band( p.y, 0.793, 0.807 ) ).mul( chest ), accent );
	paint( line( p.y.sub( yokeLine ), 0.001 ).mul( back ), trim, 0.6 );
	if ( profile.bomber ) {

		// One sleeve utility pocket and its broad pull mark the bomber.
		const sleevePocket = band( p.x, 0.2, 0.244 ).mul( band( p.y, 0.735, 0.777 ) ).mul( arm ).mul( front );
		paint( sleevePocket, secondary );
		paint( band( p.x, 0.208, 0.214 ).mul( band( p.y, 0.741, 0.772 ) ).mul( arm ).mul( front ), accent );
		paint( band( p.y, 0.846, 0.854 ).mul( neck ), accent, 0.8 );

	} else {

		paint( band( p.x, 0.036, 0.063 ).mul( band( p.y, 0.771, 0.784 ) ).mul( chest ), accent, 0.9 );
		paint( arm.mul( band( ax, 0.213, 0.267 ) ), secondary, 0.55 );

	}

}

function paintTailoredTop( profile, { p, ax, arm, neck, body, chest, back, side, secondary, accent, trim, paint } ) {

	paint( side.mul( body ), secondary, profile.vest ? 0.48 : 0.25 );
	paint( below( p.y, profile.hem + 0.007 ).mul( body ), trim, 0.7 );
	if ( profile.vest ) {

		const opening = smoothstep( 0.665, 0.827, p.y ).mul( 0.044 ).add( 0.012 ).toVar();
		paint( below( ax, opening ).mul( above( p.y, 0.665 ) ).mul( chest ), secondary );
		paint( neck, secondary );
		paint( band( ax.sub( opening ), 0, 0.013 ).mul( band( p.y, 0.673, 0.831 ) ).mul( chest ), trim, 0.85 );
		paint( line( ax.sub( opening ).sub( 0.011 ), 0.0012 ).mul( band( p.y, 0.695, 0.829 ) ).mul( chest ), accent, 0.8 );
		paint( band( p.x, 0.036, 0.066 ).mul( band( p.y, 0.746, 0.761 ) ).mul( chest ), accent );
		paint( band( ax, 0.043, 0.083 ).mul( band( p.y, 0.62, 0.626 ) ).mul( chest ), secondary );
		paint( line( p.x, 0.001 ).mul( back ).mul( band( p.y, 0.59, 0.804 ) ), trim, 0.4 );
		for ( const y of [ 0.596, 0.625, 0.654 ] ) paint( circle( p.x, p.y.sub( y ), 0.0025 ).mul( chest ), accent );

	} else {

		paint( above( p.y, 0.79 ).mul( body ), secondary, 0.7 );
		paint( neck, secondary );
		const pocket = band( ax, 0.028, 0.077 ).mul( band( p.y, 0.698, 0.756 ) ).mul( chest );
		paint( pocket, secondary );
		paint( band( ax, 0.026, 0.079 ).mul( band( p.y, 0.744, 0.758 ) ).mul( chest ), accent, 0.85 );
		paint( line( p.y.sub( 0.698 ), 0.0008 ).mul( band( ax, 0.031, 0.074 ) ).mul( chest ), trim, 0.6 );
		paint( arm.mul( above( ax, profile.cuff ) ), secondary );
		paint( arm.mul( band( ax, profile.cuff, profile.cuff + 0.007 ) ), accent );
		paint( line( p.x, 0.0034 ).mul( chest ).mul( band( p.y, profile.hem + 0.008, 0.839 ) ), secondary );
		for ( const y of [ 0.583, 0.625, 0.667, 0.709, 0.751, 0.793 ] ) paint( circle( p.x, p.y.sub( y ), 0.0018 ).mul( chest ), accent );
		paint( line( p.y.sub( 0.79 ), 0.0008 ).mul( back ), trim, 0.6 );

	}

}

function paintTrousers( profile, { p, n, ax, front, back, outer, side, secondary, accent, trim, paint } ) {

	const leg = below( p.y, 0.517 ).toVar();
	paint( above( p.y, profile.waist ), secondary );
	// Shorts keep a plain folded hem in the body colour; their pocket flaps
	// carry the detail colour and the leg opening stays quiet.
	if ( ! profile.short ) paint( below( p.y, profile.cuff ), secondary );
	paint( line( p.y.sub( profile.waist ), 0.001 ), trim, 0.7 );
	if ( profile.family === 'stretch' ) {

		paint( side.mul( band( p.y, profile.cuff, profile.waist ) ), secondary, profile.jogger ? 0.55 : 0.95 );
		paint( band( outer, 0.55, 0.66 ).mul( band( p.y, profile.cuff + 0.01, 0.51 ) ), accent, 0.85 );
		paint( band( p.y, profile.hem + 0.01, profile.hem + 0.019 ), accent );
		if ( profile.jogger ) {

			paint( line( ax.sub( 0.009 ), 0.0018 ).mul( band( p.y, 0.578, 0.614 ) ).mul( front ), accent );
			paint( band( ax, 0.008, 0.019 ).mul( band( p.y, 0.572, 0.578 ) ).mul( front ), accent );
			paint( band( outer, 0.35, 0.72 ).mul( band( p.y, 0.48, 0.535 ) ).mul( front ), trim, 0.6 );

		} else {

			paint( band( p.y, 0.614, 0.624 ), accent, 0.85 );
			paint( band( p.y, 0.281, 0.323 ).mul( front ), secondary, 0.45 );

		}

	} else {

		paint( line( p.x, 0.0013 ).mul( front ).mul( band( p.y, 0.512, profile.waist ) ), trim, 0.75 );
		paint( band( p.x, - 0.01, 0.01 ).mul( band( p.y, profile.waist + 0.004, profile.waist + 0.017 ) ).mul( front ), accent );
		if ( ! profile.short ) paint( band( p.y, profile.hem + 0.009, profile.hem + 0.016 ), accent, 0.9 );
		if ( profile.family === 'utility' ) {

			const [ start, end ] = profile.pocket;
			paint( side.mul( band( p.y, start, end ) ), secondary );
			paint( side.mul( band( p.y, end - 0.018, end - 0.004 ) ), accent, 0.9 );
			paint( line( p.y.sub( start ), 0.001 ).mul( side ), trim, 0.75 );
			paint( line( outer.sub( 0.42 ), 0.03 ).mul( band( p.y, start, end ) ), trim, 0.65 );
			if ( ! profile.short ) {

				paint( front.mul( band( p.y, 0.264, 0.328 ) ), secondary, 0.6 );
				paint( line( p.y.sub( 0.328 ), 0.001 ).mul( front ), trim, 0.6 );

			}

		} else {

			const pocketLine = outer.mul( 0.033 ).add( 0.523 ).toVar();
			paint( line( p.y.sub( pocketLine ), 0.0035 ).mul( front ).mul( above( outer, 0.28 ) ), secondary );
			paint( line( p.y.sub( pocketLine ).sub( 0.004 ), 0.0012 ).mul( front ).mul( above( outer, 0.28 ) ), accent, 0.85 );
			paint( line( n.x, 0.023 ).mul( front.max( back ) ).mul( leg ).mul( above( p.y, profile.cuff ) ), secondary, 0.23 );
			paint( band( ax, 0.031, 0.077 ).mul( band( p.y, 0.521, 0.527 ) ).mul( back ), secondary );

		}

	}

}

function paintSneakers( profile, { p, n, back, side, secondary, accent, trim, paint } ) {

	const upper = above( p.y, 0.029 ).toVar();
	const vamp = smoothstep( 0.25, 0.75, n.y ).mul( band( p.z, - 0.012, 0.026 ) ).mul( upper ).toVar();
	paint( above( p.z, 0.025 ).mul( below( p.y, 0.074 ) ), secondary, 0.85 );
	paint( side.mul( band( p.z, - 0.027, 0.022 ) ).mul( upper ), secondary, 0.85 );
	paint( above( p.y, profile.top - 0.017 ), secondary );
	paint( vamp, trim, 0.85 );
	paint( periodicLine( p.z.mul( 180 ), 0.15 ).mul( vamp ), accent );
	paint( band( p.y, 0.014, 0.031 ), secondary );
	paint( below( p.y, 0.014 ), trim );
	paint( band( p.y, 0.017, 0.022 ), accent );
	// A short diagonal side stripe and heel tab stay legible at full-body size.
	paint( band( p.y.sub( p.z.mul( 0.5 ) ), 0.04, 0.049 ).mul( side ).mul( band( p.z, - 0.022, 0.025 ) ), accent );
	paint( back.mul( band( p.y, 0.048, profile.high ? 0.113 : 0.079 ) ), accent, 0.85 );
	paint( line( p.z.sub( 0.025 ), 0.001 ).mul( upper ), trim, 0.55 );
	if ( profile.high ) {

		paint( band( p.y, 0.12, 0.133 ), accent, 0.9 );
		paint( band( p.y, 0.14, 0.151 ), trim, 0.65 );

	}

}

function paintBoots( profile, { p, front, back, side, secondary, accent, trim, paint } ) {

	paint( above( p.z, 0.03 ).mul( below( p.y, 0.071 ) ), secondary, 0.45 );
	paint( below( p.y, 0.02 ), trim );
	paint( band( p.y, 0.021, 0.026 ), accent, 0.9 );
	paint( line( p.z.sub( 0.03 ), 0.001 ).mul( band( p.y, 0.027, 0.074 ) ), trim, 0.65 );
	paint( above( p.y, profile.top - 0.013 ), secondary );
	if ( profile.tall ) {

		paint( side.mul( band( p.y, 0.112, 0.267 ) ), secondary, 0.85 );
		paint( back.mul( band( p.y, 0.074, 0.267 ) ), secondary, 0.45 );
		paint( band( p.y, 0.264, 0.278 ), accent, 0.9 );
		paint( band( p.y, 0.09, 0.103 ), secondary );
		paint( side.mul( band( p.y, 0.092, 0.108 ) ), accent );
		paint( line( p.x.abs().sub( 0.062 ), 0.001 ).mul( front ).mul( band( p.y, 0.113, 0.259 ) ), trim, 0.55 );

	} else {

		const gore = side.mul( band( p.z, - 0.032, 0.012 ) ).mul( band( p.y, 0.061, 0.129 ) ).toVar();
		paint( gore, secondary );
		// Elastic ribs use the pinstripes' derivative filter.
		paint( periodicLine( p.z.mul( 380 ), 0.11 ).mul( gore ), trim, 0.23 );
		paint( back.mul( above( p.y, 0.115 ) ), accent );
		paint( side.mul( band( p.y, 0.119, 0.13 ) ).mul( band( p.z, - 0.01, 0.012 ) ), accent, 0.9 );

	}

}

// A feather of at least half a millimetre and the screen derivatives keep panel
// edges crisp up close and steady when the person is a few hundred pixels tall.
function above( value, boundary ) {

	const distance = value.sub( boundary );
	const aa = fwidth( distance ).mul( 0.7 ).max( 0.00028 );
	return smoothstep( aa.negate(), aa, distance );

}

function below( value, boundary ) {

	return above( value, boundary ).oneMinus();

}

function band( value, start, end ) {

	return above( value, start ).mul( below( value, end ) );

}

function line( distance, width ) {

	return below( distance.abs(), width );

}

function circle( x, y, radius ) {

	return below( x.mul( x ).add( y.mul( y ) ).sqrt(), radius );

}

function periodicLine( value, width ) {

	const aa = fwidth( value ).max( 0.001 );
	const distance = value.fract().sub( 0.5 ).abs();
	return smoothstep( float( width ).sub( aa ), float( width ).add( aa ), distance ).oneMinus().mul( smoothstep( 0.12, 0.48, aa ).oneMinus() );

}

function constructionHeight( id, p, shares ) {

	// These masks feed a height derivative: never use the colour masks' fwidth
	// here, since differentiating an already differentiated mask is unstable.
	const below = ( value, boundary ) => smoothstep( boundary - 0.0004, boundary + 0.0004, value ).oneMinus();
	const band = ( value, start, end ) => below( value, start ).oneMinus().mul( below( value, end ) );
	const ridge = ( distance, width, height ) => smoothstep( width, width * 2, distance.abs() ).oneMinus().mul( height );
	const arm = smoothstep( 0.28, 0.72, shares.y );
	const body = arm.oneMinus().mul( smoothstep( 0.16, 0.58, shares.z ).oneMinus() );
	if ( id.startsWith( 'pants-' ) ) {

		const hem = id === 'pants-shorts' ? 0.361 : id === 'pants-office' || id === 'pants-chinos' ? 0.086 : 0.073;
		return ridge( p.y.sub( hem ), 0.0018, 0.00038 )
			.add( ridge( p.y.sub( 0.608 ), 0.0015, 0.0003 ) )
			.add( ridge( p.z.add( 0.001 ), 0.0013, 0.00025 ).mul( below( p.y, 0.51 ) ) );

	}
	if ( /^(boots|shoes|sneakers)-/.test( id ) ) return ridge( p.y.sub( 0.026 ), 0.0013, 0.00065 )
		.add( ridge( p.z.sub( 0.029 ), 0.001, 0.00025 ).mul( band( p.y, 0.032, 0.068 ) ) );
	const profile = TOP_PROFILES[ id ];
	const hem = profile?.hem ?? ( id === 'police-jacket' ? 0.55 : id === 'office-jacket' ? 0.565 : 0.58 );
	const cuff = profile?.cuff ?? ( id === 'office-jacket' ? 0.284 : 0.329 );
	const hemSeam = ridge( p.y.sub( hem + 0.005 ), 0.0012, 0.0004 ).mul( body );
	const cuffSeam = ridge( p.x.abs().sub( cuff ), 0.0015, 0.0004 ).mul( arm );
	const sideSeam = ridge( p.z, 0.0012, 0.00028 ).mul( body ).mul( band( p.y, hem, 0.78 ) );
	return hemSeam.add( cuffSeam ).add( sideSeam );

}
