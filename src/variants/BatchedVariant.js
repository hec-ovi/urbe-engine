import * as THREE from 'three/webgpu';
import { Variant } from './Variant.js';
import { ARCHETYPES } from '../city/archetypes.js';

/**
 * Variant B: one BatchedMesh holding every building, perObjectFrustumCulled.
 * One multi-draw call on WebGL; one draw per visible instance on WebGPU
 * (docs/RESEARCH.md 0). No LOD.
 */
export class BatchedVariant extends Variant {

	async build( ctx ) {

		await super.build( ctx );

		const { city, archetypes } = ctx;

		let maxVertexCount = 0;
		let maxIndexCount = 0;
		for ( const a of archetypes ) {

			maxVertexCount += a.position.count;
			maxIndexCount += a.lodIndices[ 0 ].length;

		}

		this.material = new THREE.MeshLambertMaterial();
		this.mesh = new THREE.BatchedMesh(
			city.buildings.length, maxVertexCount, maxIndexCount, this.material
		);
		this.mesh.perObjectFrustumCulled = true;

		const geometryIds = archetypes.map( ( a ) => this.mesh.addGeometry( a.lod0 ) );
		const matrix = new THREE.Matrix4();
		const color = new THREE.Color();

		for ( const b of city.buildings ) {

			const id = this.mesh.addInstance( geometryIds[ b.archetype ] );
			matrix.makeScale( b.sx, b.sy, b.sz ).setPosition( b.x, 0, b.z );
			this.mesh.setMatrixAt( id, matrix );
			this.mesh.setColorAt( id, color.setHex( ARCHETYPES[ b.archetype ].color ) );

		}

		ctx.scene.add( this.mesh );

	}

	visibleInstances() {

		// Set by BatchedMesh's own frustum pass during onBeforeRender.
		return { total: this.mesh._multiDrawCount, byLod: null };

	}

	dispose() {

		this.ctx.scene.remove( this.mesh );
		this.mesh.dispose();
		this.material.dispose();

	}

}
