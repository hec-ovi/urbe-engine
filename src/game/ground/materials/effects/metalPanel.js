import { float, mix, smoothstep } from 'three/tsl';
import { ambient, bounded, normal } from './common.js';

export function metalPanel( s, p ) {
	const base = s.map( 'basecolor' );
	return {
		colorNode: base.rgb, normalNode: normal( s.map( 'normal' ), p.normalScale ),
		roughnessNode: bounded( s.map( 'roughness' ).r.mul( p.roughnessGain ), p.roughnessRange ),
		metalnessNode: p.painted ? mix( p.metalness, p.paintMetalness, smoothstep( ...p.paintRange, base.r ) ) : float( p.metalness ),
		aoNode: ambient( s.map( 'ao' ), p.aoIntensity ),
		...( p.clearcoat ? { clearcoatRoughnessNode: bounded( s.map( 'smear' ).g.mul( p.coatGain ), p.coatRange ) } : {} )
	};
}
