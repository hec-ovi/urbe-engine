import * as THREE from 'three/webgpu';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { cos, float, instancedBufferAttribute, int, mix, sin, texture, vec3, vec4, vertexIndex } from 'three/tsl';
import { FRAMES } from './VatBaker.js';
import { PoseBuffer } from './PoseBuffer.js';

/**
 * One instanced draw call for an entire crowd of animated characters. The pose
 * comes out of the baked pose buffers, indexed by the vertex id and a
 * per-instance frame cursor, so there are no skeletons, no mixers and no
 * per-character CPU work beyond writing five floats.
 *
 * The instance transform is composed here rather than through instanceMatrix:
 * NodeMaterial assigns positionNode after it has applied the instanced-mesh
 * transform, so a positionNode that ignored the instance would pile the whole
 * crowd on the world origin. Each character carries its own ground position
 * and heading instead, which is also less to upload than a matrix.
 */
export class CrowdMesh {

	/**
	 * @param baked one entry from VatBaker.bake
	 * @param map base colour texture, or null
	 * @param capacity maximum simultaneous instances
	 * @param storageCapable true on the WebGPU backend
	 */
	constructor( baked, map, capacity, storageCapable ) {

		this.capacity = capacity;

		this.frames = instanced( capacity, 1 );
		this.clips = instanced( capacity, 1 );
		this.origins = instanced( capacity, 3 );
		this.headings = instanced( capacity, 1 );
		this.tints = instanced( capacity, 3 );

		const positions = new PoseBuffer( baked.position, baked.vertexCount, baked.rows, storageCapable );
		const normals = new PoseBuffer( baked.normal, baked.vertexCount, baked.rows, storageCapable );

		const aFrame = instancedBufferAttribute( this.frames, 'float' );
		const aClip = instancedBufferAttribute( this.clips, 'float' );
		const aOrigin = instancedBufferAttribute( this.origins, 'vec3' );
		const aHeading = instancedBufferAttribute( this.headings, 'float' );
		const aTint = instancedBufferAttribute( this.tints, 'vec3' );

		const whole = aFrame.floor();
		const blend = aFrame.sub( whole );
		const base = aClip.mul( float( FRAMES ) );
		const row0 = int( base.add( whole ) );
		const row1 = int( base.add( whole.add( 1 ).mod( float( FRAMES ) ) ) );
		const column = int( vertexIndex );

		const c = cos( aHeading );
		const s = sin( aHeading );
		const turn = ( v ) => vec3(
			v.x.mul( c ).add( v.z.mul( s ) ),
			v.y,
			v.x.mul( s ).negate().add( v.z.mul( c ) )
		);

		const pose = mix( positions.sample( row0, column ), positions.sample( row1, column ), blend );
		const normal = mix( normals.sample( row0, column ), normals.sample( row1, column ), blend );

		const material = new MeshStandardNodeMaterial( { roughness: 0.78, metalness: 0 } );
		material.positionNode = turn( pose ).add( aOrigin );
		material.normalNode = turn( normal ).normalize();
		material.colorNode = map ? texture( map ).mul( vec4( aTint, 1 ) ) : vec4( aTint, 1 );

		const geometry = baked.mesh.geometry.clone();
		geometry.deleteAttribute( 'skinIndex' );
		geometry.deleteAttribute( 'skinWeight' );
		geometry.boundingSphere = new THREE.Sphere( new THREE.Vector3(), 1e6 );

		this.mesh = new THREE.InstancedMesh( geometry, material, capacity );
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = true;
		this.mesh.count = 0;

		// Positions live in the instanced attributes above, so the instance
		// matrix stays identity and is never uploaded again.
		const identity = new THREE.Matrix4();

		for ( let i = 0; i < capacity; i ++ ) this.mesh.setMatrixAt( i, identity );

	}

	setInstance( slot, position, heading, frame, clip, tint ) {

		this.origins.setXYZ( slot, position.x, position.y, position.z );
		this.headings.setX( slot, heading );
		this.frames.setX( slot, frame );
		this.clips.setX( slot, clip );
		this.tints.setXYZ( slot, tint.r, tint.g, tint.b );

	}

	commit( count ) {

		this.mesh.count = count;

		for ( const attribute of [ this.origins, this.headings, this.frames, this.clips, this.tints ] ) {

			attribute.needsUpdate = true;

		}

	}

}

function instanced( capacity, itemSize ) {

	const attribute = new THREE.InstancedBufferAttribute( new Float32Array( capacity * itemSize ), itemSize );
	attribute.setUsage( THREE.DynamicDrawUsage );

	return attribute;

}

/** Shared by the crowd builders: a colour texture downscaled on the way in. */
export async function loadResizedTexture( url, size ) {

	const response = await fetch( url );

	if ( ! response.ok ) throw new Error( `${url}: HTTP ${response.status}` );

	const blob = await response.blob();
	const bitmap = await createImageBitmap( blob, {
		resizeWidth: size,
		resizeHeight: size,
		resizeQuality: 'high'
	} );

	const map = new THREE.Texture( bitmap );
	map.colorSpace = THREE.SRGBColorSpace;
	map.flipY = false;
	map.needsUpdate = true;

	return map;

}
