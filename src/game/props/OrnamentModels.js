import * as THREE from 'three/webgpu';
import { Parts, metreUvs } from './Geometry.js';

/** Small service-pocket fixtures with recessed faces and separate structural parts. */
export class OrnamentModels {
	static build( spec, material, colors ) {
		const p = new Parts(), [ w, h, d ] = spec.size;
		if ( spec.shape === 'cabinet' ) {
			p.box( 'paint', [ w, h - 0.12, d ], [ 0, ( h + 0.12 ) / 2, 0 ] );
			p.box( 'metal', [ w * 0.84, 0.12, d * 0.84 ], [ 0, 0.06, 0 ] );
			p.box( 'seal', [ w * 0.87, h * 0.8, 0.012 ], [ 0, h * 0.52, d / 2 + 0.006 ] );
			p.box( 'paint', [ w * 0.81, h * 0.76, 0.025 ], [ - 0.01, h * 0.52, d / 2 + 0.018 ] );
			p.box( 'metal', [ 0.025, 0.16, 0.032 ], [ w * 0.3, h * 0.56, d / 2 + 0.045 ] );
			for ( let i = 0; i < 6; i ++ ) p.box( 'ink', [ w * 0.48, 0.016, 0.006 ], [ - w * 0.1, h * 0.23 + i * 0.032, d / 2 + 0.034 ] );
			for ( const y of [ 0.24, 0.75 ] ) p.box( 'metal', [ 0.028, 0.08, 0.036 ], [ - w * 0.39, h * y, d / 2 + 0.03 ] );
			p.box( 'warning', [ w * 0.3, 0.06, 0.005 ], [ - w * 0.13, h * 0.73, d / 2 + 0.034 ], [ 0, 0, 0.07 ] );
			if ( spec.open ) {
				for ( const x of [ - 0.28, 0.19 ] ) p.box( 'paint', [ 0.06, h * 0.78, 0.065 ], [ x * w, h * 0.47, - d / 2 - 0.065 ] );
				p.box( 'metal', [ w * 0.7, 0.065, 0.065 ], [ 0, h * 0.84, - d / 2 - 0.065 ] );
			}
		} else if ( spec.shape === 'bench' ) {
			for ( const x of [ - 0.36, 0.36 ] ) {
				p.box( 'metal', [ 0.09, 0.42, d * 0.82 ], [ x * w, 0.21, 0 ] );
				p.box( 'paint', [ 0.07, h - 0.42, 0.07 ], [ x * w, ( h + 0.42 ) / 2, - d * 0.4 ] );
			}
			for ( let i = 0; i < 4; i ++ ) p.box( i === 2 && spec.open ? 'wood' : 'polymer', [ w, 0.052, d / 5 ], [ i === 2 && spec.open ? 0.025 : 0, 0.446 - ( i === 2 ? 0.008 : 0 ), ( i - 1.5 ) * d / 4.6 ] );
			for ( let i = 0; i < 2; i ++ ) p.box( 'polymer', [ w, 0.105, 0.04 ], [ 0, h - 0.07 - i * 0.15, - d * 0.4 ], [ - 0.1, 0, 0 ] );
		} else if ( spec.shape === 'memorial' ) {
			p.box( 'metal', [ w, 0.09, d ], [ 0, 0.045, 0 ] );
			p.box( 'paint', [ w * 0.77, h - 0.09, d * 0.64 ], [ - w * 0.04, ( h + 0.09 ) / 2, - d * 0.1 ] );
			p.box( 'seal', [ w * 0.61, h * 0.46, 0.014 ], [ - w * 0.04, h * 0.64, d * 0.22 + 0.008 ] );
			for ( let i = 0; i < 5; i ++ ) p.box( 'label', [ w * ( 0.36 - i % 2 * 0.1 ), 0.008, 0.003 ], [ - w * 0.09, h * 0.78 - i * 0.034, d * 0.22 + 0.017 ] );
			for ( const [ x, z, height ] of [ [ - 0.25, 0.36, 0.1 ], [ 0.17, 0.32, 0.07 ], [ 0.31, 0.23, 0.12 ] ] ) {
				const cup = metreUvs( new THREE.CylinderGeometry( 0.027, 0.03, height, 8 ) );
				cup.translate( x * w, 0.09 + height / 2, z * d ); p.add( 'seal', cup );
				p.box( 'warning', [ 0.016, 0.012, 0.016 ], [ x * w, 0.09 + height, z * d ] );
			}
		}
		return p.finish( material, colors );
	}
}
