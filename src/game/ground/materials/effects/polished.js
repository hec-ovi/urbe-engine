import { color, float, positionWorld } from 'three/tsl';
import { bounded, normal } from './common.js';

export function polished( s, p ) {
	const smear = s.map( 'smear' ).g;
	return {
		colorNode: s.map( 'basecolor' ).rgb.mul( color( p.tint ) ),
		normalNode: normal( s.map( 'normal' ), p.normalScale ),
		metalnessNode: float( p.metalness ),
		roughnessNode: bounded( smear.mul( p.smearGain ).add( s.map( 'variation', positionWorld.xz.div( p.variationScale ) ).r.mul( p.variationGain ) ), p.roughnessRange ),
		clearcoatRoughnessNode: bounded( smear.add( p.coatBias ).mul( p.coatGain ), p.coatRange )
	};
}
