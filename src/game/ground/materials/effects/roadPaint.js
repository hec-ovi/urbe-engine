import { color, float, mix, mx_noise_float, positionWorld, smoothstep, vec2 } from 'three/tsl';
import { bounded, normal } from './common.js';

/**
 * Road paint over the asphalt grain. Where the binding publishes a worn paint
 * finish for the marking (its response surface), the paint takes that
 * finish's own colour and roughness, read in world metres, so a line is
 * ragged and dull or polished where its maps say; otherwise its tint and one
 * roughness. The marking's mask, erosion and opacity are its own either way.
 */
export function roadPaint( s, p ) {
	const offset = mx_noise_float( positionWorld.mul( p.noiseScale ) ).mul( p.noiseGain );
	const mask = s.map( 'mask', vec2( s.uv.x.mul( p.maskUScale ).add( offset ), s.uv.y ) ).r;
	const grain = s.road( 'grain' ).r;
	const response = s.response, q = s.responseParameters;
	return {
		colorNode: ( response ? response( 'basecolor' ).rgb : color( p.tint ) ).mul( grain.mul( p.grainGain ).add( p.grainBias ) ),
		opacityNode: mask.mul( mix( p.opacity, smoothstep( ...p.erosionRange, grain ), s.wear.mul( p.wearStrength ) ) ),
		roughnessNode: response ? bounded( response( 'roughness' ).r.mul( q.roughnessGain ?? 1 ).add( q.roughnessBias ?? 0 ), q.roughnessRange ?? [ 0, 1 ] ) : float( p.roughness ),
		normalNode: normal( s.road( 'normal' ), p.normalScale, true )
	};
}
