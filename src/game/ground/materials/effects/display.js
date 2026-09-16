import { color, float } from 'three/tsl';

export function display( s, p ) {
	const face = s.map( 'basecolor' ).rgb.mul( color( p.tint ) );
	return { colorNode: face, emissiveNode: face.mul( p.brightness ), roughnessNode: float( p.roughness ), metalnessNode: float( 0 ) };
}
