import { color, mix, smoothstep } from 'three/tsl';
import { ambient, bounded, normal } from './common.js';

export function mineral( s, p ) {
	const base = s.map( 'basecolor' );
	return {
		colorNode: p.painted ? mix( base.rgb, color( p.tint ).mul( base.r.add( p.paintBias ) ), smoothstep( ...p.paintRange, base.r ) ) : base.rgb,
		normalNode: normal( s.map( 'normal' ), p.normalScale ),
		roughnessNode: bounded( s.map( 'roughness' ).r.mul( p.roughnessGain ).add( p.roughnessBias ), p.roughnessRange ),
		aoNode: ambient( s.map( 'ao' ), p.aoIntensity ),
		...( p.clearcoat ? { clearcoatRoughnessNode: bounded( s.map( 'smear' ).g.mul( p.coatGain ), p.coatRange ) } : {} )
	};
}
