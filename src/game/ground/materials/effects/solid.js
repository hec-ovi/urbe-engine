import { color, float } from 'three/tsl';

export function solid( s, p ) {
	return { colorNode: color( p.tint ), roughnessNode: float( p.roughness ), metalnessNode: float( p.metalness ) };
}
