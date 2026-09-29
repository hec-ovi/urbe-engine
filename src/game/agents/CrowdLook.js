import { attribute, float, floor, max, mix, mod, positionGeometry, pow, smoothstep, step, texture, varying, vec3, vec4 } from 'three/tsl';
import { HEIGHT_LIMITS } from './avatar/Recipe.js';
import { skinNode } from './avatar/Tints.js';
import { fabricDetail } from './Fabric.js';

/** Height steps a crowd body can stand at, across the recipes' range. */
const STATURES = 31;
/** How wide a cut's edge fades, as a share of body height: about a centimetre. */
const EDGE = 0.006;
/** How far a seam's shadow reaches either side of a cut, as a share of height. */
const SEAM = 0.01;
/** Above this share of a vertex the head drives, no collar reaches it. */
const HEAD_IN = 0.1;
const HEAD_OUT = 0.3;
/** Past this far down the leg a vertex is thigh, which no top covers. */
const LEG_IN = 0.09;
const LEG_OUT = 0.13;
/** Along the garment map's arm, where the arm proper starts: past the clavicle, short of the upper arm. */
const ARM_FROM = 0.2;
/** Shoes are the trousers' colour a shade deeper where footwear paints none of its own. */
const SOLE = 0.85;
const packs = new WeakMap();

/**
 * One person's look as the crowd's per-instance attributes carry it. The
 * dressed body already fills WebGPU's eight vertex buffers, so what a look
 * adds rides in the lanes they left: whole numbers of up to 24 bits, which a
 * float holds exactly, unpacked in the vertex stage.
 *
 * - `cuts`: the sleeve's reach, the top's hem and the trousers' hem, a byte each
 * - `shoes`, `panel`: the footwear's and the top's second colour, as sRGB bytes
 * - `figure`: the footwear's top and the collar a byte each, then the top's
 *   panel style (2 bits), whether it is tucked (1) and the height step (5)
 */
export function packLook( look ) {

	let pack = packs.get( look );
	if ( pack ) return pack;
	const height = Math.round( ( ( look.height ?? 1 ) - HEIGHT_LIMITS[ 0 ] ) / ( HEIGHT_LIMITS[ 1 ] - HEIGHT_LIMITS[ 0 ] ) * STATURES );
	pack = {
		cuts: byte( look.sleeve ) + byte( look.topHem ) * 256 + byte( look.pantsHem ) * 65536,
		shoes: look.shoes.getHex(),
		panel: look.panel.getHex(),
		figure: byte( look.bootTop ) + byte( look.neck ) * 256
			+ ( ( look.panelStyle & 3 ) | ( look.tucked ? 4 : 0 ) | ( Math.max( 0, Math.min( STATURES, height ) ) << 3 ) ) * 65536
	};
	packs.set( look, pack );
	return pack;

}

/** The share of its frame's height a body stands at, from its figure lane (vertex stage). */
export function statureNode( figure ) {

	const step = floor( figure.div( 65536 * 8 ) );
	return float( HEIGHT_LIMITS[ 0 ] ).add( step.div( STATURES ).mul( HEIGHT_LIMITS[ 1 ] - HEIGHT_LIMITS[ 0 ] ) );

}

/**
 * Where the crowd paints each garment on a body, from the look's cuts and the
 * body's rest pose: the bind position says how high a point is and how far
 * out along the outstretched arm, as the garment patterns measure it, and the
 * garment map (Garments.js) says what drives it. Masks are 0 to 1:
 *
 * - `top`: between its hem and collar, off the head and the thigh, and on the
 *   arm as far as its sleeve reaches
 * - `pants`: between its hem and the waist
 * - `shoes`: below the footwear's top
 * - `panel`: where the top shows its second colour: an open front, a yoke,
 *   or a yoke and upper sleeves
 *
 * @param lanes the per-instance nodes: `{ cuts, figure }`
 * @param frame the rest body's `{ height, bottom }`, in its own units
 */
export function crowdGarments( { cuts, figure }, { height, bottom } ) {

	const cut = varying( bytes( cuts ).div( 255 ) );
	const shape = varying( bytes( figure ) );
	const sleeve = cut.x;
	const topHem = cut.y;
	const pantsHem = cut.z;
	const bootTop = shape.x.div( 255 );
	const neck = shape.y.div( 255 );
	// Decoded before they cross to the fragment, where an interpolated whole
	// number is only nearly whole; read back through thresholds.
	const flags = varying( vec3( mod( floor( figure.div( 65536 ) ), 4 ), mod( floor( figure.div( 65536 * 4 ) ), 2 ), 0 ) );
	const style = flags.x;
	const tucked = step( 0.5, flags.y );
	const cloth = attribute( 'cloth', 'vec4' );
	const y = positionGeometry.y.sub( bottom ).div( height );
	const out = positionGeometry.x.abs().div( height );
	const z = positionGeometry.z.div( height );
	// The garment map starts the arm at the clavicle (0); the chest the
	// clavicle carries is the top's body, and the arm proper begins at the
	// upper arm (0.28).
	const onArm = step( ARM_FROM, cloth.y ).mul( step( cloth.y, 1.5 ) );
	const onLeg = step( cloth.z, 1.5 );
	const between = ( low, high ) => smoothstep( low.sub( EDGE ), low.add( EDGE ), y ).mul( float( 1 ).sub( smoothstep( high.sub( EDGE ), high.add( EDGE ), y ) ) );
	const offHead = float( 1 ).sub( smoothstep( HEAD_IN, HEAD_OUT, cloth.x ) );
	const offThigh = float( 1 ).sub( onLeg.mul( smoothstep( LEG_IN, LEG_OUT, cloth.z ) ) );
	const armCut = float( 1 ).sub( smoothstep( sleeve.sub( EDGE ), sleeve.add( EDGE ), out ) );
	const topBand = between( topHem, neck ).mul( offHead );
	const top = topBand.mul( mix( offThigh, armCut, onArm ) );
	const waist = float( 0.628 );
	const pants = between( pantsHem, waist );
	const shoes = float( 1 ).sub( smoothstep( bootTop.sub( EDGE ), bootTop.add( EDGE ), y ) );
	// The inner shirt of an open jacket or vest narrows to a V above its fastening.
	const opening = smoothstep( 0.659, 0.825, y ).mul( 0.046 ).add( 0.01 );
	// The body faces +Z with its spine about 2 % of its height behind the origin.
	const front = smoothstep( - 0.03, - 0.01, z );
	// Its collar is the inner shirt's too, round the neck and not over the shoulders.
	const collar = smoothstep( 0.83, 0.838, y ).mul( float( 1 ).sub( smoothstep( 0.05, 0.065, out ) ) );
	const open = max( float( 1 ).sub( smoothstep( opening.sub( 0.003 ), opening.add( 0.003 ), out ) ).mul( smoothstep( 0.662, 0.67, y ) ).mul( front ), collar )
		.mul( float( 1 ).sub( onArm ) );
	// Across the shoulders of the body, not down the arms; a duty jacket also
	// takes the second colour on its upper sleeves.
	const yoke = smoothstep( 0.778, 0.786, y.sub( out.mul( 0.12 ) ) ).mul( float( 1 ).sub( onArm ) ).mul( 0.85 );
	const sleeves = float( 1 ).sub( smoothstep( 0.178, 0.19, out ) ).mul( onArm ).mul( 0.65 );
	const panel = open.mul( step( 0.5, style ).mul( step( style, 1.5 ) ) ).add( yoke.mul( step( 1.5, style ) ) ).add( sleeves.mul( step( 2.5, style ) ) );
	// A cut the look does not make (no top, trousers or shoes) leaves no seam.
	const across = ( edge, worn ) => float( 1 ).sub( smoothstep( 0.0015, SEAM, y.sub( edge ).abs() ) ).mul( worn );
	const seam = max( max( across( topHem, step( topHem, 0.99 ) ), across( pantsHem, step( pantsHem, 0.99 ) ) ),
		max( across( bootTop, step( 0.01, bootTop ) ), float( 1 ).sub( smoothstep( 0.0015, SEAM, out.sub( sleeve ).abs() ) ).mul( onArm ).mul( step( 0.01, sleeve ) ) ) );
	return { top, pants, shoes, panel, tucked, seam };

}

/**
 * A crowd body's surface: skin over the pack's map in the person's colour,
 * then the trousers, the top (under or over the trousers' waist as it is
 * worn) with its second colour, and the footwear, each in its own colour with
 * the filtered weave and a seam shadow at every cut.
 *
 * @param colors `{ skin, shirt, trousers, shoes, panel }` nodes, linear; `shoes` and `panel` packed sRGB
 */
export function paintedColorNode( map, colors, garments, eyeMap = null ) {

	const { top, pants, shoes, panel, tucked, seam } = garments;
	const { thread } = fabricDetail();
	const weave = thread.mul( 0.025 ).add( 1 ).sub( seam.mul( 0.12 ) );
	const bare = skinNode( map, colors.skin );
	const shoe = varying( linear( rgb( colors.shoes ) ) );
	const second = varying( linear( rgb( colors.panel ) ) );
	const upper = mix( colors.shirt, second, panel ).mul( weave );
	const lower = colors.trousers.mul( weave );
	const outer = top.mul( float( 1 ).sub( pants.mul( tucked ) ) );
	const trousers = mix( bare, lower, pants );
	const dressed = mix( trousers, upper, outer );
	const body = mix( dressed, shoe.mul( SOLE ).mul( float( 1 ).sub( seam.mul( 0.08 ) ) ), shoes );
	const cloth = attribute( 'cloth', 'vec4' );
	const surface = eyeMap ? mix( texture( eyeMap ).rgb, body, step( 0, cloth.x ) ) : body;
	return vec4( surface, 1 );

}

/** How much of a crowd body's surface is cloth, for its fabric response. */
export function clothShare( { top, pants, shoes } ) {

	return max( top, max( pants, shoes ) );

}

function byte( share ) {

	return Math.max( 0, Math.min( 255, Math.round( ( share ?? 0 ) * 255 ) ) );

}

/** A lane's three bytes, low first. */
function bytes( lane ) {

	return vec3( mod( lane, 256 ), mod( floor( lane.div( 256 ) ), 256 ), floor( lane.div( 65536 ) ) );

}

/** A packed 0xRRGGBB colour's channels, 0 to 1. */
function rgb( lane ) {

	const channels = bytes( lane );
	return vec3( channels.z, channels.y, channels.x ).div( 255 );

}

/** sRGB to linear, exactly. */
function linear( c ) {

	return mix( c.div( 12.92 ), pow( c.add( 0.055 ).div( 1.055 ), vec3( 2.4 ) ), step( 0.04045, c ) );

}
