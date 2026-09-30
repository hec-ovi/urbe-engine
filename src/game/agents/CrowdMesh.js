import * as THREE from 'three/webgpu';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { cos, instancedBufferAttribute, int, mix, sin, transformNormalToView, varying, vec3, vertexIndex } from 'three/tsl';
import { FRAMES, clipRows, rowsAt } from './VatBaker.js';
import { presenceMaterial } from './Presence.js';
import { PoseBuffer } from './PoseBuffer.js';
import { packLook, statureNode } from './CrowdLook.js';

/** How every crowd surface answers light; a focused rig wears the same, so the swap does not show. */
export const CROWD_SURFACE = { roughness: 0.9, metalness: 0 };

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
		/** Where each clip's rows sit in the pose buffers (VatBaker.clipRows). */
		this.clips = baked.clips ?? clipRows( Math.max( 1, Math.round( baked.rows / FRAMES ) ) );
		this.rows = [ 0, 0 ];

		// Every attribute is one vertex buffer on WebGPU, which allows eight per
		// pipeline, so the per-instance data is packed: where a person stands
		// and faces in one vec4, the two pose rows their frame of their clip
		// blends with presence and their figure (CrowdLook.packLook) in another.
		this.motion = this.attribute( 4 );
		this.pose = this.attribute( 4 );

		const aMotion = instancedBufferAttribute( this.motion, 'vec4' );
		const aPose = instancedBufferAttribute( this.pose, 'vec4' );
		/** The figure lane: height, footwear, collar and top style, read by a subclass's paint. */
		this.figure = aPose.w;
		// The first row and how far towards the second, then the second: the
		// clip's own row count and whether it loops are the CPU's (VatBaker.rowsAt).
		const aRow = aPose.x;
		const aOrigin = aMotion.xyz;
		const aHeading = aMotion.w;

		const whole = aRow.floor();
		const blend = aRow.sub( whole );
		const row0 = int( whole );
		const row1 = int( aPose.y.add( 0.5 ) );
		const column = int( vertexIndex );

		const c = cos( aHeading );
		const s = sin( aHeading );
		const turn = ( v ) => vec3(
			v.x.mul( c ).add( v.z.mul( s ) ),
			v.y,
			v.x.mul( s ).negate().add( v.z.mul( c ) )
		);

		const posed = this.posed( baked, storageCapable, { row0, row1, blend, column } );
		// A person stands at their recipe's height: the baked body scaled about its feet.
		const pose = posed.position.mul( statureNode( aPose.w ) );
		const normal = posed.normal;

		const geometry = baked.mesh.geometry.clone();
		// Source exports carry unused secondary UV and colour channels. Position
		// gives the draw its vertex count and uv samples the body map; every other
		// source attribute is replaced by the pose buffers or the garment map,
		// unless the subclass reads it (`kept`).
		const kept = new Set( [ 'position', 'uv', ...this.kept() ] );
		for ( const name of Object.keys( geometry.attributes ) ) {

			if ( ! kept.has( name ) ) geometry.deleteAttribute( name );

		}
		geometry.boundingSphere = new THREE.Sphere( new THREE.Vector3(), 1e6 );

		const material = presenceMaterial( new MeshStandardNodeMaterial( CROWD_SURFACE ), aPose.z );
		material.positionNode = turn( pose ).add( aOrigin );
		// normalNode is consumed in view space. The baked vector first follows
		// the same per-person heading as the position. Sample in the vertex
		// stage so its float normal interpolates across the triangle.
		material.normalNode = transformNormalToView( varying( turn( normal ) ) ).normalize();
		material.colorNode = this.colorNode( geometry, paint );
		this.surface?.( material );

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

	/**
	 * Where a vertex stands and faces in this frame of this clip, in the rest
	 * body's space: by default its own baked row, blended to the next.
	 *
	 * @returns `{ position, normal }` nodes
	 */
	posed( baked, storageCapable, { row0, row1, blend, column } ) {

		const positions = new PoseBuffer( baked.position, baked.vertexCount, baked.rows, storageCapable );
		const normals = new PoseBuffer( baked.normal, baked.vertexCount, baked.rows, storageCapable );
		return {
			position: mix( positions.sample( row0, column ), positions.sample( row1, column ), blend ),
			normal: mix( normals.sample( row0, column ), normals.sample( row1, column ), blend )
		};

	}

	/** Source attributes a subclass reads besides position and uv. */
	kept() {

		return [];

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

	/**
	 * @param frame how far through the clip, 0 to FRAMES whatever its row count
	 * @param clip the clip's index in the bake
	 */
	setInstance( slot, position, heading, frame, clip, look, presence = 1 ) {

		const rows = rowsAt( this.clips[ clip ] ?? this.clips[ 0 ], frame, this.rows );
		this.motion.setXYZW( slot, position.x, position.y, position.z, heading );
		this.pose.setXYZW( slot, rows[ 0 ], rows[ 1 ], presence, packLook( look ).figure );
		this.setLook( slot, look );

	}

	commit( count ) {

		this.mesh.count = count;
		this.mesh.geometry.instanceCount = count;

		for ( const attribute of this.attributes ) attribute.needsUpdate = true;

	}

}
