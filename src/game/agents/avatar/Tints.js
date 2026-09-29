import { Color } from 'three/webgpu';
import { float, max, min, mix, smoothstep, texture, uv, vec3, vec4 } from 'three/tsl';

/**
 * The median colour of the pack's maps, measured off the Source files: every
 * body's Dark base colour sits within 2/255 of the skin tone, both hair maps
 * of the hair tone.
 */
export const SKIN_TONE = new Color( '#aa7451' );
export const HAIR_TONE = new Color( '#8c8e8c' );
/**
 * How bright the studio draws a colour on a median pixel of its map: it
 * greys the map with its eightieth percentile at 235 and tints the grey, which
 * puts the skin map's median at 0.72 of the colour and the hair map's at 0.66.
 */
const SKIN_LEVEL = 0.72;
const HAIR_LEVEL = 0.66;

/** Per channel, what turns a map's median into the level the studio draws a colour at. */
export const SKIN_SCALE = scale( SKIN_TONE, SKIN_LEVEL );
export const HAIR_SCALE = scale( HAIR_TONE, HAIR_LEVEL );

/**
 * A skin in a recipe's colour over the pack's own skin map: the map's detail
 * and its own hue shifts (lips, nails, creases) stay, its median becomes the
 * colour at the studio's level. The crowd and a focused body paint the same.
 *
 * @param color a node of the skin colour, linear
 */
export function skinNode( map, color ) {

	return texture( map ).rgb.mul( vec3( SKIN_SCALE.r, SKIN_SCALE.g, SKIN_SCALE.b ) ).mul( color );

}

/** Hair and brows in a recipe's colour over the pack's hair map, the crowd's and a focused body's alike. */
export function hairNode( map, color ) {

	return vec4( texture( map ).rgb.mul( vec3( HAIR_SCALE.r, HAIR_SCALE.g, HAIR_SCALE.b ) ).mul( color ), 1 );

}

/**
 * The pack's eye with its iris in a recipe's colour: the iris sits at the
 * centre of the shared eye map, so a disc there, narrowed to its saturated
 * pixels (the sclera's pink is not), takes the colour over the map's own
 * shading; the white and the pupil stay as drawn.
 */
export function eyeNode( map, color ) {

	const sample = texture( map ).rgb;
	const iris = float( 1 ).sub( smoothstep( 0.095, 0.115, uv().sub( 0.5 ).length() ) );
	const high = max( sample.r, max( sample.g, sample.b ) );
	const low = min( sample.r, min( sample.g, sample.b ) );
	const saturated = smoothstep( 0.12, 0.4, high.sub( low ).div( high.max( 0.001 ) ) );
	const detail = sample.dot( vec3( 0.2126, 0.7152, 0.0722 ) ).mul( 5 ).min( 1 );
	return vec4( mix( sample, color.mul( detail ), iris.mul( saturated ) ), 1 );

}

function scale( tone, level ) {

	return new Color( level / tone.r, level / tone.g, level / tone.b );

}
