import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { streetLampAssembly, streetLampMaterials, wallPackAssembly } from './StreetLampModel.js';

/** Shared original fixture geometry, instanced separately in each spatial cell. */
export class StreetLampInstances {

	constructor( factory ) {

		this.materials = streetLampMaterials( factory );
		this.templates = new Map();
		for ( const [ kind, assembly ] of [ [ 'post', streetLampAssembly( { x: 0, z: 0, ax: 1, az: 0 } ) ], [ 'wall', wallPackAssembly() ] ] ) {
			const parts = {};
			// The original tapered pole keeps its facet orientation in world space.
			if ( kind === 'post' ) parts.pole = assembly.structure.shift();
			for ( const role of [ 'structure', 'lenses' ] ) {
				parts[ role ] = mergeGeometries( assembly[ role ], false );
				for ( const geometry of assembly[ role ] ) geometry.dispose();
			}
			this.templates.set( kind, parts );
		}

	}

	build( records ) {

		const group = new THREE.Group();
		const matrix = new THREE.Matrix4();
		for ( const [ kind, parts ] of this.templates ) {
			const placed = records.filter( record => record.kind === kind );
			if ( ! placed.length ) continue;
			for ( const [ role, geometry ] of Object.entries( parts ) ) {
				const mesh = new THREE.InstancedMesh( geometry, this.materials[ role === 'pole' ? 'structure' : role ], placed.length );
				mesh.userData.streetFixtures = { kind, role, ids: placed.map( record => record.id ) };
				for ( const [ index, record ] of placed.entries() ) {
					matrix.makeRotationY( role === 'pole' ? 0 : - Math.atan2( record.az, record.ax ) );
					matrix.setPosition( record.x, 0, record.z );
					mesh.setMatrixAt( index, matrix );
				}
				mesh.instanceMatrix.needsUpdate = true;
				mesh.computeBoundingBox();
				mesh.computeBoundingSphere();
				group.add( mesh );
			}
		}
		return group;

	}

	release( group ) { group.traverse( node => { if ( node.isInstancedMesh ) node.dispose(); } ); }
	dispose() { for ( const parts of this.templates.values() ) for ( const geometry of Object.values( parts ) ) geometry.dispose(); }

}
