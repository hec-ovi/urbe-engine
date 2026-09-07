import * as THREE from 'three/webgpu';
import { Parts, metreUvs } from './Geometry.js';

/** Thin walls, open flaps, board gaps and pallet feet retain their silhouettes. */
export class DeliveryModels {
	static build( spec, material, colors ) {
		const parts = new Parts();
		const [ w, h, d ] = spec.size;
		if ( spec.shape === 'carton' ) carton( parts, w, h, d, spec.open );
		if ( spec.shape === 'crate' ) crate( parts, w, h, d );
		if ( spec.shape === 'pallet' ) pallet( parts, w, h, d );
		if ( spec.shape === 'paper' ) {
			parts.box( 'cardboard', [ w * 0.64, 0.003, d ], [ - w * 0.18, 0.003, 0 ] );
			parts.box( 'cardboard', [ w * 0.36, 0.003, d ], [ w * 0.32, h / 2, 0 ], [ 0, 0, 0.16 ] );
		}
		if ( spec.shape === 'can' ) {
			const can = metreUvs( new THREE.CylinderGeometry( w / 2, w * 0.38, d, 10 ) );
			can.rotateX( Math.PI / 2 ).scale( 1, 0.72, 1 ).translate( 0, w * 0.36, 0 );
			parts.add( 'metal', can );
		}
		return parts.finish( material, colors );
	}
}

function carton( p, w, h, d, open ) {
	const t = 0.008;
	p.box( 'cardboard', [ w, t, d ], [ 0, t / 2, 0 ] );
	for ( const side of [ - 1, 1 ] ) {
		p.box( 'cardboard', [ w, h, t ], [ 0, h / 2, side * ( d - t ) / 2 ] );
		p.box( 'cardboard', [ t, h, d - 2 * t ], [ side * ( w - t ) / 2, h / 2, 0 ] );
		const tilt = open ? side * 0.8 : side * 0.018;
		p.box( 'cardboard', [ w / 2 - 0.004, t, d ], [ side * w * ( open ? 0.66 : 0.25 ), h + ( open ? 0.06 : 0 ), 0 ], [ 0, 0, tilt ] );
	}
	if ( ! open ) {
		p.box( 'tape', [ 0.065, 0.002, d ], [ 0, h + t, 0 ] );
		for ( const side of [ - 1, 1 ] ) p.box( 'tape', [ 0.065, h * 0.23, 0.002 ], [ 0, h * 0.885, side * ( d / 2 + 0.002 ) ] );
	}
	p.box( 'label', [ w * 0.28, h * 0.25, 0.002 ], [ w * 0.2, h * 0.6, d / 2 + 0.003 ] );
	for ( let i = 0; i < 9; i ++ ) p.box( 'ink', [ w * ( i % 3 === 0 ? 0.008 : 0.003 ), h * 0.12, 0.001 ], [ w * ( 0.10 + i * 0.022 ), h * 0.61, d / 2 + 0.0045 ] );
}

function crate( p, w, h, d ) {
	const board = h / 4.4;
	for ( let row = 0; row < 4; row ++ ) {
		const y = board / 2 + row * h / 4;
		for ( const s of [ - 1, 1 ] ) {
			p.box( 'wood', [ w, board, 0.035 ], [ 0, y, s * ( d / 2 - 0.018 ) ] );
			p.box( 'wood', [ 0.035, board, d - 0.07 ], [ s * ( w / 2 - 0.018 ), y, 0 ] );
		}
	}
	p.box( 'wood', [ w - 0.07, 0.035, d - 0.07 ], [ 0, 0.018, 0 ] );
	for ( const x of [ - 1, 1 ] ) for ( const z of [ - 1, 1 ] ) p.box( 'wood', [ 0.045, h, 0.045 ], [ x * ( w / 2 - 0.056 ), h / 2, z * ( d / 2 - 0.056 ) ] );
	for ( const z of [ - 1, 1 ] ) p.box( 'wood', [ Math.hypot( w * 0.8, h * 0.7 ), 0.045, 0.025 ], [ 0, h / 2, z * ( d / 2 + 0.012 ) ], [ 0, 0, Math.atan2( h * 0.7, w * 0.8 ) ] );
}

function pallet( p, w, h, d ) {
	for ( const x of [ - 0.42, 0, 0.42 ] ) {
		p.box( 'wood', [ w * 0.12, h * 0.22, d ], [ x * w, h * 0.11, 0 ] );
		for ( const z of [ - 0.4, 0, 0.4 ] ) p.box( 'wood', [ w * 0.12, h * 0.56, d * 0.15 ], [ x * w, h * 0.5, z * d ] );
	}
	for ( let i = 0; i < 5; i ++ ) p.box( 'wood', [ w, h * 0.22, d * 0.16 ], [ 0, h * 0.89, ( i - 2 ) * d * 0.2 ] );
}
