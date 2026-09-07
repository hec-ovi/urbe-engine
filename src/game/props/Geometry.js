import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Geometry assembled in metres, then merged by material role. */
export class Parts {
	constructor() { this.roles = new Map(); }
	add( role, geometry ) {
		if ( ! this.roles.has( role ) ) this.roles.set( role, [] );
		this.roles.get( role ).push( geometry );
		return this;
	}
	box( role, size, position, rotation = [ 0, 0, 0 ] ) {
		const geometry = metreUvs( new THREE.BoxGeometry( ...size ) );
		geometry.applyMatrix4( new THREE.Matrix4().compose( new THREE.Vector3( ...position ), new THREE.Quaternion().setFromEuler( new THREE.Euler( ...rotation ) ), new THREE.Vector3( 1, 1, 1 ) ) );
		return this.add( role, geometry );
	}
	finish( material, colors = {} ) {
		const batches = new Map();
		for ( const [ role, geometries ] of this.roles ) {
			const surface = material( role ), tintable = role !== 'metal' && ! colors[ role ];
			const key = `${surface.uuid}:${tintable}`;
			if ( ! batches.has( key ) ) batches.set( key, { material: surface, tintable, pieces: [] } );
			for ( const source of geometries ) {
				const geometry = triangleGeometry( source ); source.dispose();
				if ( surface.vertexColors ) {
					const color = new THREE.Color( colors[ role ] ?? '#ffffff' );
					const attribute = new THREE.Float32BufferAttribute( geometry.attributes.position.count * 3, 3 );
					for ( let i = 0; i < attribute.count; i ++ ) attribute.setXYZ( i, color.r, color.g, color.b );
					geometry.setAttribute( 'color', attribute );
				}
				batches.get( key ).pieces.push( geometry );
			}
		}
		return [ ...batches.values() ].map( ( { material, tintable, pieces } ) => {
			const geometry = mergeGeometries( pieces ); pieces.forEach( part => part.dispose() );
			return { geometry, material, tintable };
		} );
	}
}

export function triangleGeometry( source ) {
	const geometry = source.index ? source.toNonIndexed() : source.clone();
	for ( const key of Object.keys( geometry.attributes ) ) if ( ! [ 'position', 'normal', 'tangent', 'color', 'uv', 'uv1', 'uv2', 'uv3' ].includes( key ) ) geometry.deleteAttribute( key );
	if ( ! geometry.attributes.normal ) geometry.computeVertexNormals();
	if ( ! geometry.attributes.uv ) geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( new Float32Array( geometry.attributes.position.count * 2 ), 2 ) );
	geometry.clearGroups();
	return geometry;
}

export function metreUvs( geometry ) {
	const p = geometry.attributes.position, n = geometry.attributes.normal, uv = geometry.attributes.uv;
	for ( let i = 0; i < p.count; i ++ ) {
		const axis = Math.abs( n.getY( i ) ) > 0.5 ? 'y' : Math.abs( n.getX( i ) ) > 0.5 ? 'x' : 'z';
		uv.setXY( i, axis === 'x' ? p.getZ( i ) : p.getX( i ), axis === 'y' ? - p.getZ( i ) : - p.getY( i ) );
	}
	return geometry;
}

export function solidBox( size, center = [ 0, size[ 1 ] / 2, 0 ] ) {
	const source = new THREE.BoxGeometry( ...size );
	const geometry = source.toNonIndexed().translate( ...center );
	source.dispose();
	geometry.deleteAttribute( 'normal' ); geometry.deleteAttribute( 'uv' );
	return geometry;
}
