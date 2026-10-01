import { color, float, mix } from 'three/tsl';
import { ambient, bounded, normal } from './common.js';

/**
 * How a photographed surface shows the wear its placement samples: a used
 * stretch of street is a little darker and duller, from the clean surface at
 * wear 0 to at most WORN at wear 1. The detail layer, where it runs, lays its
 * smears, grime and stains on top in proportion to the same wear.
 */
const WORN = { color: 0.84, roughness: 0.07 };

export function photographed( s, p ) {
	const use = s.wear;
	return {
		colorNode: s.map( 'basecolor' ).rgb.mul( color( p.tint ) ).mul( mix( 1, WORN.color, use ) ),
		normalNode: normal( s.map( 'normal' ), p.normalScale ),
		roughnessNode: bounded( s.map( 'roughness' ).r.mul( p.roughnessGain ).add( p.roughnessBias ).add( use.mul( WORN.roughness ) ), p.roughnessRange ),
		metalnessNode: float( p.metalness ), aoNode: ambient( s.map( 'ao' ), p.aoIntensity )
	};
}
