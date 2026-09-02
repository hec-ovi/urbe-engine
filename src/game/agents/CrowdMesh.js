import * as THREE from 'three/webgpu';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { cos, float, instancedBufferAttribute, int, mix, sin, vec3, vertexIndex } from 'three/tsl';
import { FRAMES } from './VatBaker.js';
import { PoseBuffer } from './PoseBuffer.js';

/**
 * One instanced draw call for an entire crowd of animated characters. The pose
 * comes out of the baked pose buffers, indexed by the vertex id and a
 * per-instance frame cursor, so there are no skeletons, no mixers and no
 * per-character CPU work beyond writing a handful of floats.
 *
 * The instance transform is composed here rather than through instanceMatrix:
 * NodeMaterial assigns positionNode after it has applied the instanced-mesh
 * transform, so a positionNode that ignored the instance would pile the whole
 * crowd on the world origin. Each character carries its own ground position
 * and heading instead, which is also less to upload than a matrix.
 *
 * Pose and transform are all this class knows. What the surface looks like is
 * the subclass's: it declares its own per-instance attributes in `colorNode`
 * and fills them in `setLook`.
 */
export class CrowdMesh {

	/**
	 * @param baked one entry from VatBaker.bake
	 * @param capacity maximum simultaneous instances
	 * @param storageCapable true on the WebGPU backend (see PoseBuffer)
	 * @param paint whatever this subclass's colorNode needs
	 */
	constructor( baked, capacity, storageCapable, paint ) {

		this.capacity = capacity;
		this.attributes = [];

		// Every attribute is one vertex buffer on WebGPU, which allows eight per
		// pipeline, so the per-instance data is packed: where a person stands
		// and faces in one vec4, which frame of which clip in one vec2.
		this.motion = this.attribute( 4 );
		this.pose = this.attribute( 2 );

		const positions = new PoseBuffer( baked.position, baked.vertexCount, baked.rows, storageCapable );
		const normals = new PoseBuffer( baked.normal, baked.vertexCount, baked.rows, storageCapable );

		const aMotion = instancedBufferAttribute( this.motion, 'vec4' );
		const aPose = instancedBufferAttribute( this.pose, 'vec2' );
		const aFrame = aPose.x;
		const aClip = aPose.y;
		const aOrigin = aMotion.xyz;
		const aHeading = aMotion.w;

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

		const geometry = baked.mesh.geometry.clone();
		// Source exports carry unused secondary UV and colour channels. Position
		// gives the draw its vertex count and uv samples the body map; every other
		// source attribute is replaced by the pose buffers or the garment map.
		for ( const name of Object.keys( geometry.attributes ) ) {

			if ( name !== 'position' && name !== 'uv' ) geometry.deleteAttribute( name );

		}
		geometry.boundingSphere = new THREE.Sphere( new THREE.Vector3(), 1e6 );

		const material = new MeshStandardNodeMaterial( { roughness: 0.78, metalness: 0 } );
		material.positionNode = turn( pose ).add( aOrigin );
		material.normalNode = turn( normal ).normalize();
		material.colorNode = this.colorNode( geometry, paint );

		// An InstancedMesh binds its identity instanceMatrix even though this
		// shader replaces it, taking a ninth vertex buffer on devices whose limit
		// is eight. InstancedBufferGeometry issues the same instanced draw without
		// that unused binding.
		const instanced = new THREE.InstancedBufferGeometry().copy( geometry );
		instanced.instanceCount = 0;
		this.mesh = new THREE.Mesh( instanced, material );
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = true;
		this.mesh.count = 0;

	}

	/** A per-instance attribute of this crowd's capacity, uploaded with the rest. */
	attribute( itemSize ) {

		const attribute = new THREE.InstancedBufferAttribute(
			new Float32Array( this.capacity * itemSize ), itemSize
		);
		attribute.setUsage( THREE.DynamicDrawUsage );
		this.attributes.push( attribute );

		return attribute;

	}

	/**
	 * @abstract
	 * @param geometry this mesh's own geometry, free to take extra attributes
	 * @param paint the descriptor handed to the constructor
	 * @returns the material's colour node
	 */
	colorNode() {

		throw new Error( 'a CrowdMesh subclass paints itself' );

	}

	/**
	 * @abstract writes one person's appearance into this mesh's attributes
	 */
	setLook() {}

	setInstance( slot, position, heading, frame, clip, look ) {

		this.motion.setXYZW( slot, position.x, position.y, position.z, heading );
		this.pose.setXY( slot, frame, clip );
		this.setLook( slot, look );

	}

	commit( count ) {

		this.mesh.count = count;
		this.mesh.geometry.instanceCount = count;

		for ( const attribute of this.attributes ) attribute.needsUpdate = true;

	}

}
