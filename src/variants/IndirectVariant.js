import * as THREE from 'three/webgpu';
import {
	Fn, If, instanceIndex, storage, struct, uniform, uniformArray,
	attribute, vec3, uint, bool, atomicAdd, atomicStore
} from 'three/tsl';
import { Variant } from './Variant.js';
import { LOD_COUNT } from '../scene/ArchetypeGeometries.js';

/**
 * Variant C: one InstancedMesh-style draw per archetype and LOD, driven
 * entirely from the GPU. A compute pass frustum-culls every building, picks a
 * LOD by camera distance and appends the building id to that LOD's visible
 * list, bumping the instanceCount of its IndirectStorageBufferAttribute.
 * The vertex stage reads the visible list to place each box. This is the
 * r185 webgpu_struct_drawindirect pattern (docs/RESEARCH.md 0 and 9).
 * WebGPU backend only.
 */
export class IndirectVariant extends Variant {

	async build( ctx ) {

		await super.build( ctx );

		this.cameraPos = uniform( new THREE.Vector3() );
		this.planes = uniformArray(
			Array.from( { length: 6 }, () => new THREE.Vector4() ), 'vec4'
		);
		this.lodNear = uniform( Math.max( 300, ctx.city.halfExtent * 0.25 ) );
		this.lodFar = uniform( Math.max( 900, ctx.city.halfExtent * 0.75 ) );

		this.frustum = new THREE.Frustum();
		this.projScreen = new THREE.Matrix4();

		this.indirectStruct = struct( {
			indexCount: 'uint',
			instanceCount: { type: 'uint', atomic: true },
			firstIndex: 'uint',
			baseVertex: 'uint',
			firstInstance: 'uint'
		}, 'IndirectDraw' );

		this.groups = [];
		this.computes = [];
		this.meshes = [];

		for ( let a = 0; a < ctx.archetypes.length; a ++ ) {

			const group = this.buildArchetypeGroup( ctx, a );
			this.groups.push( group );
			this.computes.push( group.cullReset, group.cull );
			this.meshes.push( ...group.meshes );

		}

	}

	/** All GPU buffers, draws and compute kernels for one archetype. */
	buildArchetypeGroup( ctx, archetypeIndex ) {

		const arch = ctx.archetypes[ archetypeIndex ];
		const buildings = ctx.city.buildings.filter( ( b ) => b.archetype === archetypeIndex );
		const n = buildings.length;

		// Per-instance data: (x, z, boundingRadius) and (sx, sy, sz).
		const placementArray = new Float32Array( n * 4 );
		const scaleArray = new Float32Array( n * 4 );

		for ( let i = 0; i < n; i ++ ) {

			const b = buildings[ i ];
			placementArray.set( [ b.x, b.z, 0.5 * Math.hypot( b.sx, b.sy, b.sz ), 0 ], i * 4 );
			scaleArray.set( [ b.sx, b.sy, b.sz, 0 ], i * 4 );

		}

		const placementAttribute = new THREE.StorageBufferAttribute( placementArray, 4 );
		const scaleAttribute = new THREE.StorageBufferAttribute( scaleArray, 4 );

		// The same attribute needs two nodes: read-write in compute, read-only
		// in the vertex stage (setAccess mutates the node it is called on).
		const placements = storage( placementAttribute, 'vec4', n );
		const scales = storage( scaleAttribute, 'vec4', n );

		// Per LOD: indirect draw args, visible-id list, geometry, draw.
		const lods = [];
		const meshes = [];

		for ( let level = 0; level < LOD_COUNT; level ++ ) {

			const indexArray = arch.lodIndices[ level ];

			const indirectAttribute = new THREE.IndirectStorageBufferAttribute(
				new Uint32Array( [ indexArray.length, 0, 0, 0, 0 ] ), 5
			);
			const indirect = storage( indirectAttribute, this.indirectStruct, indirectAttribute.count );

			const visibleAttribute = new THREE.StorageBufferAttribute( new Uint32Array( n ), 1 );
			const visible = storage( visibleAttribute, 'uint', n );

			const geometry = new THREE.InstancedBufferGeometry();
			geometry.setAttribute( 'position', arch.position );
			geometry.setAttribute( 'normal', arch.normal );
			geometry.setIndex( new THREE.BufferAttribute( indexArray, 1 ) );
			geometry.instanceCount = n;
			geometry.setIndirect( indirectAttribute );

			const material = new THREE.MeshLambertNodeMaterial( { color: arch.def.color } );
			const visibleRead = storage( visibleAttribute, 'uint', n ).toReadOnly();
			const placementsRead = storage( placementAttribute, 'vec4', n ).toReadOnly();
			const scalesRead = storage( scaleAttribute, 'vec4', n ).toReadOnly();

			material.positionNode = Fn( () => {

				const id = visibleRead.element( instanceIndex );
				const p = placementsRead.element( id );
				const s = scalesRead.element( id );
				return attribute( 'position' ).mul( s.xyz ).add( vec3( p.x, 0, p.y ) );

			} )();

			const mesh = new THREE.Mesh( geometry, material );
			mesh.frustumCulled = false;
			ctx.scene.add( mesh );

			lods.push( { indirectAttribute, indirect, visible } );
			meshes.push( mesh );

		}

		const cullReset = Fn( () => {

			for ( const lod of lods ) {

				atomicStore( lod.indirect.get( 'instanceCount' ), uint( 0 ) );

			}

		} )().compute( 1 );

		const { cameraPos, planes, lodNear, lodFar } = this;

		const cull = Fn( () => {

			If( instanceIndex.lessThan( uint( n ) ), () => {

				const p = placements.element( instanceIndex );
				const s = scales.element( instanceIndex );
				const center = vec3( p.x, s.y.mul( 0.5 ), p.y ).toVar();
				const radius = p.z.toVar();

				const inside = bool( true ).toVar();
				for ( let k = 0; k < 6; k ++ ) {

					const plane = planes.element( k );
					inside.assign( inside.and(
						plane.xyz.dot( center ).add( plane.w ).greaterThanEqual( radius.negate() )
					) );

				}

				If( inside, () => {

					const dist = center.distance( cameraPos ).toVar();
					const level = uint( LOD_COUNT - 1 ).toVar();
					If( dist.lessThan( lodNear ), () => { level.assign( 0 ); } )
						.ElseIf( dist.lessThan( lodFar ), () => { level.assign( 1 ); } );

					for ( let l = 0; l < LOD_COUNT; l ++ ) {

						If( level.equal( uint( l ) ), () => {

							const slot = atomicAdd( lods[ l ].indirect.get( 'instanceCount' ), uint( 1 ) ).toVar();
							lods[ l ].visible.element( slot ).assign( instanceIndex );

						} );

					}

				} );

			} );

		} )().compute( n );

		return { n, lods, meshes, cullReset, cull };

	}

	update( camera ) {

		this.cameraPos.value.copy( camera.position );

		this.projScreen.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse );
		this.frustum.setFromProjectionMatrix( this.projScreen, this.ctx.renderer.coordinateSystem );

		for ( let k = 0; k < 6; k ++ ) {

			const plane = this.frustum.planes[ k ];
			this.planes.array[ k ].set( plane.normal.x, plane.normal.y, plane.normal.z, plane.constant );

		}

		for ( const compute of this.computes ) {

			this.ctx.renderer.compute( compute );

		}

	}

	/** Reads the GPU-written instance counts back; called on a slow interval. */
	async readVisible() {

		const byLod = new Array( LOD_COUNT ).fill( 0 );

		for ( const group of this.groups ) {

			for ( let l = 0; l < LOD_COUNT; l ++ ) {

				const data = await this.ctx.renderer.getArrayBufferAsync( group.lods[ l ].indirectAttribute );
				byLod[ l ] += new Uint32Array( data )[ 1 ];

			}

		}

		this.lastVisible = { total: byLod.reduce( ( a, b ) => a + b, 0 ), byLod };

	}

	visibleInstances() {

		return this.lastVisible ?? { total: null, byLod: null };

	}

	dispose() {

		for ( const mesh of this.meshes ) {

			this.ctx.scene.remove( mesh );
			mesh.geometry.dispose();
			mesh.material.dispose();

		}

	}

}
