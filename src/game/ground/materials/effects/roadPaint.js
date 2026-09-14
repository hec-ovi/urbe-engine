import { color, float, mix, mx_noise_float, positionWorld, smoothstep, vec2 } from 'three/tsl';
import { normal } from './common.js';

export function roadPaint( s, p ) {
	const offset = mx_noise_float( positionWorld.mul( p.noiseScale ) ).mul( p.noiseGain );
	const mask = s.map( 'mask', vec2( s.uv.x.mul( p.maskUScale ).add( offset ), s.uv.y ) ).r;
	const grain = s.road( 'grain' ).r;
	return {
		colorNode: color( p.tint ).mul( grain.mul( p.grainGain ).add( p.grainBias ) ),
		opacityNode: mask.mul( mix( p.opacity, smoothstep( ...p.erosionRange, grain ), s.wear.mul( p.wearStrength ) ) ),
		roughnessNode: float( p.roughness ), normalNode: normal( s.road( 'normal' ), p.normalScale )
	};
}
