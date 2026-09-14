import { color, float, mix, smoothstep } from 'three/tsl';
import { normal } from './common.js';

export function hardware( s, p ) {
	const base = s.map( 'basecolor' );
	const paint = smoothstep( ...p.paintRange, base.g );
	const metalColor = base.rgb.mul( p.colorGain );
	return {
		colorNode: p.painted ? mix( metalColor, color( p.tint ).mul( base.r.mul( p.paintGain ).add( p.paintBias ) ), paint ) : metalColor,
		metalnessNode: p.painted ? mix( 1, 0, paint ) : float( 1 ),
		normalNode: normal( s.map( 'normal' ), p.normalScale ),
		roughnessNode: s.map( 'roughness' ).r, aoNode: s.map( 'ao' ).r
	};
}
