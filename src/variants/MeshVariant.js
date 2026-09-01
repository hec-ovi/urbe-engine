import * as THREE from 'three/webgpu';
import { Variant } from './Variant.js';

/**
 * Variant A: one Mesh per building. The naive baseline; geometry and material
 * are shared per archetype, every building is its own render item.
 */
export class MeshVariant extends Variant {

	async build( ctx ) {

		await super.build( ctx );

		this.materials = ctx.archetypes.map(
			( a ) => new THREE.MeshLambertMaterial( { color: a.def.color } )
		);

		this.group = new THREE.Group();
		this.group.matrixAutoUpdate = false;

		for ( const b of ctx.city.buildings ) {

			const mesh = new THREE.Mesh( ctx.archetypes[ b.archetype ].lod0, this.materials[ b.archetype ] );
			mesh.position.set( b.x, 0, b.z );
			mesh.scale.set( b.sx, b.sy, b.sz );
			mesh.updateMatrix();
			mesh.matrixAutoUpdate = false;
			this.group.add( mesh );

		}

		ctx.scene.add( this.group );

	}

	visibleInstances( info ) {

		// Every visible building is exactly one draw call on both backends.
		return { total: info.render.drawCalls - this.ctx.staticDrawCalls, byLod: null };

	}

	dispose() {

		this.ctx.scene.remove( this.group );
		for ( const m of this.materials ) m.dispose();

	}

}
