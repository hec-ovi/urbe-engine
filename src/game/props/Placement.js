import * as THREE from 'three/webgpu';
import { rectangle } from './Footprints.js';

const TRUNK = new THREE.Box3( new THREE.Vector3( - 0.18, 0, - 0.18 ), new THREE.Vector3( 0.18, 2.7, 0.18 ) );

export function footprint( bounds, matrix ) {
	return rectangle( bounds.min.x, bounds.min.z, bounds.max.x, bounds.max.z ).map( ( [ x, z ] ) => {
		const p = new THREE.Vector3( x, 0, z ).applyMatrix4( matrix ); return [ p.x, p.z ];
	} );
}
export function placement( model, matrix, identity ) {
	const tree = model.kind === 'tree';
	const ring = footprint( tree ? model.bounds.clone().union( TRUNK ) : model.bounds, matrix );
	return { ...identity, model: model.id, kind: model.kind, matrix, footprint: ring,
		support: tree ? footprint( TRUNK, matrix ) : ring,
		lowFootprint: footprint( tree ? model.lowBounds.clone().union( TRUNK ) : model.lowBounds, matrix ),
		bottom: matrix.elements[ 13 ] + model.bounds.min.y, top: matrix.elements[ 13 ] + model.bounds.max.y };
}
export function seedOf( seed ) {
	let hash = 2166136261;
	for ( const char of seed ) hash = Math.imul( hash ^ char.charCodeAt( 0 ), 16777619 );
	return hash >>> 0;
}
export function pick( values, rng ) { return values[ Math.floor( rng.next() * values.length ) ]; }
