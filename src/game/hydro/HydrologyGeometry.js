import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { HydrologyError } from './HydrologyError.js';

// GPU positions are Float32; at Atlas' 5 km maximum extent that preserves a
// published millimetre grid within a sub-millimetre comparison tolerance.
const EPSILON = 5e-4;

/** One exact horizontal surface with world-metre UVs and +Y triangles. */
export function waterGeometry( ring, elevation ) {

	const shape = new THREE.Shape( ring.map( ( [ x, z ] ) => new THREE.Vector2( x, - z ) ) );
	const geometry = new THREE.ShapeGeometry( shape );
	geometry.rotateX( - Math.PI / 2 );
	geometry.translate( 0, elevation, 0 );
	const position = geometry.getAttribute( 'position' );
	const uv = new THREE.Float32BufferAttribute( position.count * 2, 2 );
	for ( let index = 0; index < position.count; index ++ ) uv.setXY( index, position.getX( index ), - position.getZ( index ) );
	geometry.setAttribute( 'uv', uv );
	geometry.computeVertexNormals();
	validateGeometry( geometry, ring, elevation );
	return geometry;

}

/** Merges exact polygons without retaining intermediate buffers. */
export function waterGeometries( rings, elevation ) {

	const parts = rings.map( ( ring ) => waterGeometry( ring, elevation ) );
	const geometry = parts.length === 1 ? parts[ 0 ] : BufferGeometryUtils.mergeGeometries( parts, false );
	if ( ! geometry ) {

		parts.forEach( ( part ) => part.dispose() );
		throw new HydrologyError( 'E_HYDRO_GEOMETRY', 'Water polygons could not be merged' );

	}
	if ( parts.length > 1 ) parts.forEach( ( part ) => part.dispose() );
	return geometry;

}

export function triangleCount( geometry ) {

	return ( geometry.index?.count ?? geometry.getAttribute( 'position' ).count ) / 3;

}

function validateGeometry( geometry, ring, elevation ) {

	const position = geometry.getAttribute( 'position' );
	const normal = geometry.getAttribute( 'normal' );
	const index = geometry.index;
	const count = index?.count ?? position.count;
	if ( count < 3 || count % 3 !== 0 ) fail( 'Water polygon did not triangulate' );
	const xs = ring.map( ( point ) => point[ 0 ] );
	const zs = ring.map( ( point ) => point[ 1 ] );
	const bounds = { minX: Math.min( ...xs ), maxX: Math.max( ...xs ), minZ: Math.min( ...zs ), maxZ: Math.max( ...zs ) };
	for ( let vertex = 0; vertex < position.count; vertex ++ ) {

		const values = [ position.getX( vertex ), position.getY( vertex ), position.getZ( vertex ), normal.getY( vertex ) ];
		if ( ! values.every( Number.isFinite ) ) fail( 'Water triangulation contains non-finite vertices' );
		if ( Math.abs( position.getY( vertex ) - elevation ) > EPSILON ) fail( 'Water triangulation changed its elevation' );
		if ( position.getX( vertex ) < bounds.minX - EPSILON || position.getX( vertex ) > bounds.maxX + EPSILON
			|| position.getZ( vertex ) < bounds.minZ - EPSILON || position.getZ( vertex ) > bounds.maxZ + EPSILON ) {

			fail( 'Water triangulation left its polygon bounds' );

		}
		if ( normal.getY( vertex ) < 1 - EPSILON ) fail( 'Water triangulation does not face upward' );

	}

}

function fail( message ) {

	throw new HydrologyError( 'E_HYDRO_GEOMETRY', message );

}
