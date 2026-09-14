import { mix } from 'three/tsl';
import { ambient, bounded, normal } from './common.js';

export function asphalt( s, p, options ) {
	return {
		colorNode: mix( s.road( 'cleanBasecolor' ), s.road( 'basecolor' ), s.wear ).rgb.mul( p.colorGain ),
		normalNode: normal( mix( s.road( 'cleanNormal' ), s.road( 'normal' ), s.wear ), p.normalScale ),
		roughnessNode: bounded( s.road( 'roughness' ).r.add( ( options.roadRoughness ?? p.roughnessDefault ) - p.roughnessDefault ), p.roughnessRange ),
		aoNode: ambient( s.road( 'ao' ), s.wear.mul( p.aoWear ) )
	};
}
