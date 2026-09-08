import * as THREE from 'three/webgpu';
import { GroundModuleCatalog } from './GroundModuleCatalog.js';
import { ModulePrisms, moduleCollision } from './ModulePrisms.js';
import { fail } from './GroundRegions.js';

const AXES = [ [ 1, 0 ], [ 0, 1 ], [ - 1, 0 ], [ 0, - 1 ] ];

/** Physical Atlas templates own module ground; planning covers never become meshes. */
export class GroundModules {

	constructor( atlas, geometries = new Map(), catalog = new GroundModuleCatalog( atlas ) ) {

		const source = atlas.streets?.construction?.modules;
		this.active = catalog.active;
		this.batches = [];
		if ( ! this.active ) return;
		const groups = new Map();
		for ( const placement of source.placements ) {

			const definition = catalog.definitions.get( placement.moduleId );
			const id = `${placement.moduleId}:${placement.finish}`;
			if ( ! groups.has( id ) ) {

				const bindings = catalog.bindings.get( id );
				groups.set( id, { definition, familyId: placement.finish, bindings, transforms: [] } );

			}
			const transforms = groups.get( id ).transforms;
			const [ c, s ] = AXES[ placement.turn ];
			for ( let i = 0; i < placement.count; i ++ ) {

				const x = placement.origin[ 0 ] + c * i * placement.step;
				const z = placement.origin[ 1 ] + s * i * placement.step;
				if ( ! Number.isFinite( x ) || ! Number.isFinite( z ) ) fail( 'Module repetition is not finite' );
				transforms.push( new THREE.Matrix4().set( c, 0, - s, x, 0, 1, 0, 0, s, 0, c, z, 0, 0, 0, 1 ) );

			}

		}
		for ( const { definition, familyId, bindings, transforms } of groups.values() ) {

			for ( const [ role, binding ] of bindings ) {

				const id = `${definition.id}:${role}`;
				if ( ! geometries.has( id ) ) {

					const prisms = new ModulePrisms();
					for ( const part of definition.parts ) if ( part.role === role ) prisms.add( part );
					geometries.set( id, prisms.geometry() );

				}
				this.batches.push( { moduleId: definition.id, familyId, role, binding, transforms, geometry: geometries.get( id ) } );

			}

		}

	}

	build( factory, { collision = true } = {} ) {

		const meshes = this.batches.map( ( { moduleId, familyId, role, binding, transforms, geometry } ) => {

			const mesh = new THREE.InstancedMesh( geometry, factory.build( binding.key, binding.variantId ), transforms.length );
			mesh.name = `ground:module:${moduleId}:${familyId}:${role}`;
			mesh.userData.groundModule = { moduleId, familyId, role };
			mesh.receiveShadow = true;
			transforms.forEach( ( transform, index ) => mesh.setMatrixAt( index, transform ) );
			mesh.instanceMatrix.needsUpdate = true;
			mesh.computeBoundingBox();
			mesh.computeBoundingSphere();
			return mesh;

		} );
		return { meshes, colliderGeometry: collision ? moduleCollision( this.batches.filter( batch => batch.role !== 'marking' ) ) : null };

	}

}
