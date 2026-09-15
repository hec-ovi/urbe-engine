import * as THREE from 'three/webgpu';
import { ImportedModels } from '../props/ImportedModels.js';
import catalog from '../props/catalog.json' with { type: 'json' };
import defaults from './building-models.json' with { type: 'json' };

/** One shell cell owns its imported plant parts and instanced placements. */
export class BuildingModels {

	constructor( loadAsset, { modelAssets } = {} ) {

		this.assets = { ...defaults, ...modelAssets };
		this.imported = new ImportedModels( loadAsset );
		this.group = new THREE.Group();
		this.group.name = 'building-models';
		this.unresolved = [];
		this.triangles = 0;

	}

	async load( buildings ) {

		try {

			const batches = new Map();
			for ( const { parcelId, blueprint } of buildings.values() ) {

				if ( blueprint.modelInstances != null && ! Array.isArray( blueprint.modelInstances ) ) throw new Error( `E_BUILDING_MODEL: invalid placements for ${parcelId}` );
				for ( const [ index, placement ] of ( blueprint.modelInstances ?? [] ).entries() ) {

					validate( placement, parcelId, index );
					const asset = this.assets[ placement.kind ];
					if ( asset == null ) {

						this.unresolved.push( { parcelId, index, kind: placement.kind } );
						continue;

					}
					if ( ! batches.has( asset ) ) batches.set( asset, [] );
					batches.get( asset ).push( placement );

				}

			}
			for ( const [ id, placements ] of batches ) {

				const spec = catalog.assets.find( asset => asset.id === id );
				if ( ! spec ) throw new Error( `E_BUILDING_MODEL: unknown Props asset ${id}` );
				const parts = await this.imported.load( spec );
				const bounds = new THREE.Box3();
				for ( const { geometry } of parts ) {

					geometry.computeBoundingBox();
					bounds.union( geometry.boundingBox );

				}
				// Root-centered horizontal extents include an asymmetric crown.
				const extent = [ 2 * Math.max( Math.abs( bounds.min.x ), Math.abs( bounds.max.x ) ),
					bounds.max.y, 2 * Math.max( Math.abs( bounds.min.z ), Math.abs( bounds.max.z ) ) ];
				const matrices = placements.map( placement => {

					const scale = Math.min( ...placement.size.map( ( size, axis ) => size / extent[ axis ] ) );
					return new THREE.Matrix4().compose( new THREE.Vector3( ...placement.position ),
						new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), placement.rotation ?? 0 ),
						new THREE.Vector3().setScalar( scale ) );

				} );
				for ( const [ index, { geometry, material } ] of parts.entries() ) {

					const mesh = new THREE.InstancedMesh( geometry, material, placements.length );
					mesh.name = `building-model:${id}:${index}`;
					mesh.castShadow = true;
					mesh.receiveShadow = true;
					matrices.forEach( ( matrix, instance ) => mesh.setMatrixAt( instance, matrix ) );
					mesh.instanceMatrix.needsUpdate = true;
					mesh.computeBoundingBox();
					mesh.computeBoundingSphere();
					this.group.add( mesh );
					this.triangles += ( geometry.index?.count ?? geometry.attributes.position.count ) / 3 * placements.length;

				}

			}
			return this;

		} catch ( error ) {

			this.dispose();
			throw error;

		}

	}

	dispose() {

		this.group.removeFromParent();
		for ( const mesh of this.group.children ) mesh.dispose();
		this.group.clear();
		this.imported.dispose();

	}

}

function validate( placement, parcelId, index ) {

	const triple = value => Array.isArray( value ) && value.length === 3 && value.every( Number.isFinite );
	if ( ! placement || ! Object.hasOwn( defaults, placement.kind ) || ! triple( placement.position )
		|| ! triple( placement.size ) || placement.size.some( value => value <= 0 )
		|| ! Number.isFinite( placement.rotation ?? 0 ) ) {

		throw new Error( `E_BUILDING_MODEL: invalid placement ${parcelId}:${index}` );

	}

}
