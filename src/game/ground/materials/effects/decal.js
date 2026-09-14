import { float } from 'three/tsl';

export function decal( s, p ) {
	const base = s.map( 'basecolor' );
	return { colorNode: base.rgb, opacityNode: base.a.mul( p.opacity ), roughnessNode: float( p.roughness ) };
}
