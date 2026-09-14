import { color, float } from 'three/tsl';
import { ambient, bounded, normal } from './common.js';

export function photographed( s, p ) {
	return {
		colorNode: s.map( 'basecolor' ).rgb.mul( color( p.tint ) ),
		normalNode: normal( s.map( 'normal' ), p.normalScale ),
		roughnessNode: bounded( s.map( 'roughness' ).r.mul( p.roughnessGain ).add( p.roughnessBias ), p.roughnessRange ),
		metalnessNode: float( p.metalness ), aoNode: ambient( s.map( 'ao' ), p.aoIntensity )
	};
}
