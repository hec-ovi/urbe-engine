import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Parts, metreUvs } from './Geometry.js';
import { PolymerDamage } from './PolymerDamage.js';

/** Hollow molded shells, real grip openings and reinforced lid assemblies. */
export class PolymerModels {
	static build( spec, material, colors ) {
		const p = new Parts(), [ w, h, d ] = spec.size, thickness = 0.024;
		const shellHeight = spec.lid === 'none' ? h : h - 0.055;
		mold( p, [ w, thickness, d ], [ 0, thickness / 2, 0 ] );
		for ( const side of [ - 1, 1 ] ) {
			if ( spec.lid === 'none' ) {
				mold( p, [ w, shellHeight * 0.64, thickness ], [ 0, shellHeight * 0.32, side * ( d - thickness ) / 2 ] );
				const gripWidth = w * 0.26, lower = shellHeight * 0.64, upper = shellHeight * 0.88;
				for ( const x of [ - 1, 1 ] ) mold( p, [ ( w - gripWidth ) / 2, upper - lower, thickness ], [ x * ( w + gripWidth ) / 4, ( lower + upper ) / 2, side * ( d - thickness ) / 2 ] );
				mold( p, [ w, shellHeight - upper, thickness ], [ 0, ( shellHeight + upper ) / 2, side * ( d - thickness ) / 2 ] );
			} else {
				mold( p, [ w, shellHeight, thickness ], [ 0, shellHeight / 2, side * ( d - thickness ) / 2 ] );
				for ( const x of [ - 0.14, 0.14 ] ) mold( p, [ 0.025, 0.045, 0.045 ], [ x * w, shellHeight * 0.78, side * ( d / 2 + 0.021 ) ] );
				mold( p, [ w * 0.32, 0.028, 0.025 ], [ 0, shellHeight * 0.78, side * ( d / 2 + 0.043 ) ] );
			}
			mold( p, [ thickness, shellHeight, d - thickness * 2 ], [ side * ( w - thickness ) / 2, shellHeight / 2, 0 ] );
			for ( const x of [ - 0.42, - 0.29, 0.29, 0.42 ] ) p.box( 'polymer', [ 0.024, shellHeight * 0.8, 0.024 ], [ x * w, shellHeight * 0.45, side * ( d / 2 + 0.004 ) ] );
			for ( const z of [ - 0.3, 0, 0.3 ] ) p.box( 'polymer', [ 0.024, shellHeight * 0.8, 0.028 ], [ side * ( w / 2 + 0.004 ), shellHeight * 0.45, z * d ] );
		}
		rim( p, w + 0.024, d + 0.024, shellHeight - 0.012 );
		rim( p, w - 0.012, d - 0.012, 0.045 );
		if ( spec.lid !== 'none' ) lid( p, spec, shellHeight );
		face( p, Math.min( w * 0.38, shellHeight * 0.56 ), shellHeight * 0.33, d / 2 + 0.002 );
		for ( const x of [ - 0.35, 0.35 ] ) p.box( 'warning', [ w * 0.1, 0.014, 0.002 ], [ x * w, shellHeight * 0.55, d / 2 + 0.018 ], [ 0, 0, - 0.2 ] );
		const parts = p.finish( material, colors ), damage = new PolymerDamage( spec );
		for ( const part of parts ) damage.apply( part.geometry );
		return parts;
	}
}

function mold( parts, size, position ) {
	const geometry = metreUvs( new RoundedBoxGeometry( ...size, 1, Math.min( ...size ) * 0.28 ) );
	geometry.translate( ...position ); parts.add( 'polymer', geometry );
}
function rim( p, w, d, y ) {
	for ( const side of [ - 1, 1 ] ) {
		mold( p, [ w, 0.036, 0.036 ], [ 0, y, side * ( d - 0.036 ) / 2 ] );
		mold( p, [ 0.036, 0.036, d - 0.072 ], [ side * ( w - 0.036 ) / 2, y, 0 ] );
	}
}
function lid( p, spec, shellHeight ) {
	const [ w, , d ] = spec.size;
	const cover = new Parts();
	mold( cover, [ w + 0.034, 0.048, d + 0.034 ], [ 0, 0.024, 0 ] );
	for ( const x of [ - 0.3, 0.3 ] ) mold( cover, [ 0.045, 0.018, d * 0.76 ], [ x * w, 0.051, 0 ] );
	for ( const z of [ - 0.25, 0, 0.25 ] ) cover.box( 'polymer', [ w * 0.5, 0.012, 0.025 ], [ 0, 0.052, z * d ] );
	const rotation = spec.lid === 'loose' ? [ 0.10, 0.065, - 0.12 ] : [ 0, 0, 0 ];
	const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler( new THREE.Euler( ...rotation ) );
	const geometries = [ ...cover.roles.values() ].flat();
	let underside = Infinity;
	for ( const geometry of geometries ) { geometry.applyMatrix4( rotationMatrix ); geometry.computeBoundingBox(); underside = Math.min( underside, geometry.boundingBox.min.y ); }
	for ( const [ role, pieces ] of cover.roles ) for ( const geometry of pieces ) p.add( role, geometry.translate( spec.lid === 'loose' ? 0.04 : 0, shellHeight + 0.006 - underside, 0 ) );
	for ( const x of [ - 0.32, 0.32 ] ) {
		p.box( 'seal', [ 0.064, 0.082, 0.032 ], [ x * w, shellHeight - 0.025, d / 2 + 0.019 ] );
		p.box( 'warning', [ 0.026, 0.045, 0.003 ], [ x * w, shellHeight - 0.025, d / 2 + 0.037 ] );
	}
}
function face( p, side, y, z ) {
	const panel = new THREE.PlaneGeometry( side, side, 4, 4 );
	for ( let i = 0; i < panel.attributes.uv.count; i ++ ) panel.attributes.uv.setY( i, 1 - panel.attributes.uv.getY( i ) );
	panel.translate( 0, y, z ); p.add( 'polymer-face', panel );
}
