import { mix, smoothstep } from 'three/tsl';
import { normal } from './common.js';

export function parking( s, p ) {
	const panel = s.map( 'parkingBasecolor' );
	const entrance = smoothstep( ...p.entranceRange, s.uv.y.add( panel.r.add( p.entranceBias ).mul( p.entranceNoise ) ) );
	const road = mix( s.road( 'cleanBasecolor' ), s.road( 'basecolor' ), s.wear ).rgb.mul( p.asphaltColorGain );
	return {
		colorNode: mix( road, panel.rgb.mul( p.panelColorGain ), entrance ),
		normalNode: mix( normal( s.road( 'normal' ), p.normalScale, true ), normal( s.map( 'parkingNormal' ), p.normalScale, s.world ), entrance ).normalize(),
		roughnessNode: mix( s.road( 'roughness' ).r, s.map( 'parkingRoughness' ).r, entrance ),
		aoNode: s.map( 'parkingAo' ).r
	};
}
