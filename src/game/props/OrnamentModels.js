import * as THREE from 'three/webgpu';
import { Parts, metreUvs } from './Geometry.js';

/** Small service-pocket fixtures with recessed faces and separate structural parts, and what gathers at a highway pier's foot: a tarp lean-to, a food cart and an oil drum. */
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
		} else if ( spec.shape === 'shelter' ) {
			// A lean-to against a pier: a tarp from a pole-held front edge down to
			// the ground at the back, a bedroll on flattened cardboard under it.
			p.box( 'cardboard', [ w * 0.92, 0.02, d * 0.9 ], [ 0.03, 0.01, 0 ] );
			p.box( 'fabric', [ 0.72, 0.15, d * 0.84 ], [ - w * 0.18, 0.095, - 0.02 ], [ 0, 0.05, 0 ] );
			p.box( 'fabric', [ 0.42, 0.12, 0.3 ], [ - w * 0.18, 0.2, - d * 0.32 ], [ 0.1, 0.2, 0 ] );
			const rise = h - 0.06, run = d - 0.06, slope = Math.atan2( rise, run ), length = Math.hypot( rise, run );
			// Two panels, the front one held flatter, so the tarp sags where it hangs from the rope.
			p.box( 'fabric', [ w, 0.012, length * 0.52 ], [ 0, rise * 0.76, run * 0.25 ], [ slope * 0.82, 0, 0 ] );
			p.box( 'fabric', [ w, 0.012, length * 0.52 ], [ 0, rise * 0.26, - run * 0.25 ], [ slope * 1.12, 0, 0 ] );
			for ( const x of [ - w / 2 + 0.05, w / 2 - 0.05 ] ) {
				const pole = metreUvs( new THREE.CylinderGeometry( 0.016, 0.018, h, 6 ) );
				pole.translate( x, h / 2, d / 2 - 0.04 ); p.add( 'metal', pole );
			}
			p.box( 'ink', [ w, 0.01, 0.01 ], [ 0, h - 0.01, d / 2 - 0.04 ] );
			// A blanket hung on the open side, a bucket and a pot by the door.
			p.box( 'fabric', [ 0.012, h * 0.62, d * 0.62 ], [ w / 2 - 0.02, h * 0.31, - d * 0.12 ], [ 0, 0, 0.04 ] );
			const bucket = metreUvs( new THREE.CylinderGeometry( 0.14, 0.11, 0.3, 10 ) );
			bucket.translate( w * 0.32, 0.15, d * 0.3 ); p.add( 'polymer', bucket );
			const pot = metreUvs( new THREE.CylinderGeometry( 0.11, 0.1, 0.13, 10 ) );
			pot.translate( w * 0.12, 0.065, d * 0.38 ); p.add( 'metal', pot );
		} else if ( spec.shape === 'stall' ) {
			// A food cart: a box body on four wheels, a steel counter, an awning on
			// four poles and a sign board under it.
			for ( const x of [ - w / 2 + 0.16, w / 2 - 0.16 ] ) for ( const z of [ - d / 2 + 0.14, d / 2 - 0.14 ] ) {
				const wheel = metreUvs( new THREE.CylinderGeometry( 0.12, 0.12, 0.06, 12 ) );
				wheel.rotateZ( Math.PI / 2 ); wheel.translate( x, 0.12, z ); p.add( 'polymer', wheel );
			}
			p.box( 'paint', [ w, 0.74, d ], [ 0, 0.6, 0 ] );
			p.box( 'warning', [ w * 0.96, 0.05, 0.006 ], [ 0, 0.36, d / 2 + 0.003 ] );
			p.box( 'seal', [ w * 0.42, 0.42, 0.008 ], [ - w * 0.22, 0.66, d / 2 + 0.004 ] );
			p.box( 'metal', [ w + 0.08, 0.04, d + 0.08 ], [ 0, 0.99, 0 ] );
			for ( const x of [ - w / 2 + 0.03, w / 2 - 0.03 ] ) for ( const z of [ - d / 2 + 0.03, d / 2 - 0.03 ] ) {
				p.box( 'metal', [ 0.03, h - 1.05, 0.03 ], [ x, ( h + 1.01 ) / 2, z ] );
			}
			p.box( 'fabric', [ w + 0.28, 0.014, d + 0.36 ], [ 0, h - 0.04, 0.1 ], [ - 0.14, 0, 0 ] );
			p.box( 'paint', [ w * 0.92, 0.28, 0.03 ], [ 0, h - 0.24, d / 2 + 0.02 ] );
			for ( let i = 0; i < 3; i ++ ) p.box( 'label', [ w * ( 0.62 - i * 0.14 ), 0.035, 0.004 ], [ - w * 0.05, h - 0.17 - i * 0.06, d / 2 + 0.037 ] );
			p.box( 'metal', [ w * 0.6, 0.03, 0.03 ], [ 0, 0.86, - d / 2 - 0.12 ] );
			for ( const x of [ - w * 0.3, w * 0.3 ] ) p.box( 'metal', [ 0.03, 0.03, 0.12 ], [ x, 0.86, - d / 2 - 0.06 ] );
			const pot = metreUvs( new THREE.CylinderGeometry( 0.17, 0.16, 0.24, 14 ) );
			pot.translate( w * 0.22, 1.13, - 0.05 ); p.add( 'metal', pot );
			for ( let i = 0; i < 4; i ++ ) {
				const bowl = metreUvs( new THREE.CylinderGeometry( 0.08, 0.05, 0.05, 10 ) );
				bowl.translate( - w * 0.25, 1.035 + i * 0.03, 0.12 ); p.add( 'polymer', bowl );
			}
			const bottle = metreUvs( new THREE.CylinderGeometry( 0.1, 0.1, 0.42, 10 ) );
			bottle.translate( w / 2 - 0.15, 1.22, - d / 2 + 0.16 ); p.add( 'paint', bottle );
		} else if ( spec.shape === 'drum' ) {
			// A 200 litre drum: painted shell, two rolling hoops, a dark lid.
			const shell = metreUvs( new THREE.CylinderGeometry( w / 2 - 0.01, w / 2 - 0.01, h, 18 ) );
			shell.translate( 0, h / 2, 0 ); p.add( 'paint', shell );
			for ( const y of [ h * 0.33, h * 0.67 ] ) {
				const hoop = metreUvs( new THREE.CylinderGeometry( w / 2, w / 2, 0.025, 18 ) );
				hoop.translate( 0, y, 0 ); p.add( 'metal', hoop );
			}
			const lid = metreUvs( new THREE.CylinderGeometry( w / 2 - 0.03, w / 2 - 0.03, 0.01, 18 ) );
			lid.translate( 0, h + 0.004, 0 ); p.add( 'seal', lid );
			p.box( 'warning', [ 0.16, 0.12, 0.004 ], [ 0, h * 0.5, w / 2 - 0.004 ] );
		}
		return p.finish( material, colors );
	}
}
