import * as THREE from 'three/webgpu';
import { StorageBufferAttribute } from 'three/webgpu';
import { ivec2, int, storage, textureLoad } from 'three/tsl';

/**
 * One baked pose buffer, readable from the vertex stage on either backend.
 *
 * WebGPU reads it as a storage buffer: a texture bound for a vertex-stage
 * `textureLoad` comes back empty there, and storage is the path three.js's own
 * instanced skinning uses. The WebGL2 backend has no storage buffers but does
 * have vertex texture fetch, so it reads the same data as a half float texture.
 */
export class PoseBuffer {

	/**
	 * @param data Float32Array, rows * vertexCount vec4s
	 * @param vertexCount vertices per row
	 * @param rows total frames across every clip
	 * @param storageCapable true on the WebGPU backend
	 */
	constructor( data, vertexCount, rows, storageCapable ) {

		this.vertexCount = vertexCount;

		if ( storageCapable ) {

			this.node = storage( new StorageBufferAttribute( data, 4 ), 'vec4', vertexCount * rows ).toReadOnly();

		} else {

			this.texture = new THREE.DataTexture(
				halfFloats( data ), vertexCount, rows, THREE.RGBAFormat, THREE.HalfFloatType
			);
			this.texture.minFilter = THREE.NearestFilter;
			this.texture.magFilter = THREE.NearestFilter;
			this.texture.generateMipmaps = false;
			this.texture.needsUpdate = true;

		}

	}

	/**
	 * @param row integer node, the frame to read
	 * @param vertex integer node, the vertex within the row
	 * @returns a vec3 node with that vertex's baked value
	 */
	sample( row, vertex ) {

		return this.node
			? this.node.element( row.mul( int( this.vertexCount ) ).add( vertex ) ).xyz
			: textureLoad( this.texture, ivec2( vertex, row ) ).xyz;

	}

}

/**
 * The buffer as half floats, which is what the texture path reads. A body is
 * tens of millions of values, so the engine's own conversion is used where it
 * exists and the per-value one is the fallback.
 */
export function halfFloats( data ) {

	if ( typeof Float16Array === 'function' ) return new Uint16Array( new Float16Array( data ).buffer );

	const half = new Uint16Array( data.length );

	for ( let i = 0; i < data.length; i ++ ) half[ i ] = THREE.DataUtils.toHalfFloat( data[ i ] );

	return half;

}
