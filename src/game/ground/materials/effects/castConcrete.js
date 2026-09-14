import { color, mix, smoothstep, vec3 } from 'three/tsl';
import { ambient, normal } from './common.js';

export function castConcrete( s, p ) {
	const base = s.map( 'basecolor' );
	const grey = mix( base.rgb, vec3( base.g ), p.greyMix ).mul( p.colorGain );
	const breakup = s.map( 'roughness', s.uv.mul( p.breakupScale ) ).r;
	const grime = smoothstep( ...p.grimeRange, s.height.add( breakup.add( p.grimeBias ).mul( p.grimeHeight ) ) ).oneMinus();
	return {
		colorNode: mix( grey, grey.mul( color( p.grimeTint ) ), grime.mul( p.grimeStrength ) ),
		normalNode: normal( s.map( 'normal' ), p.normalScale ),
		roughnessNode: s.map( 'roughness' ).r.mul( p.roughnessGain ).add( p.roughnessBias ),
		aoNode: ambient( s.map( 'ao' ), p.aoIntensity )
	};
}
