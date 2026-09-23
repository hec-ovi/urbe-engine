import { color, float } from 'three/tsl';

/**
 * The marquee LED face as a dark matte panel. The browser engine draws the face only; the
 * dot lattice and the scrolling message are drawn by the Unreal renderer, so no text or
 * emission appears here.
 */
export function ledMatrix( s, p ) {
	return { colorNode: color( p.faceTint ), roughnessNode: float( p.faceRoughness ), metalnessNode: float( 0 ) };
}
