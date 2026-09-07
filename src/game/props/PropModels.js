import * as THREE from 'three/webgpu';
import catalog from './catalog.json' with { type: 'json' };
import { ImportedModels } from './ImportedModels.js';
import { DeliveryModels } from './DeliveryModels.js';
import { PolymerModels } from './PolymerModels.js';
import { OrnamentModels } from './OrnamentModels.js';
import { SurfaceVariation } from './SurfaceVariation.js';
import { CargoDetails } from './CargoDetails.js';
import { metreUvs, solidBox } from './Geometry.js';

/** One catalog owns geometry and imported resources; factory materials remain shared. */
export class PropModels {
	constructor( factory, loadAsset ) {
		this.factory = factory;
		this.imported = new ImportedModels( loadAsset );
		this.models = new Map();
		this.owned = new Set();
		this.materials = new Map();
	}
	async load() {
		try {
			const sources = new Map();
			for ( const asset of catalog.assets ) sources.set( asset.id, await this.imported.load( asset ) );
			for ( const spec of catalog.models ) {
				const appearances = new Map();
				for ( const finish of spec.asset && ! spec.cargo ? [ null ] : catalog.finishes ) {
					let parts;
					if ( spec.asset ) {
						parts = sources.get( spec.asset ).map( part => ( { ...part, geometry: part.geometry.clone() } ) );
						if ( spec.cargo ) {
							const source = catalog.assets.find( asset => asset.id === spec.asset );
							for ( const part of parts ) {
								part.geometry.scale( ...spec.size.map( ( value, i ) => value / source.size[ i ] ) );
								metreUvs( part.geometry ); part.material = this.material( 'paint', finish );
							}
							parts.push( ...CargoDetails.build( spec.size, role => this.material( role, finish ) ) );
						}
					} else {
						const builder = spec.shape === 'polymer' ? PolymerModels : spec.kind === 'ornament' ? OrnamentModels : DeliveryModels;
						parts = builder.build( spec, role => this.material( role, finish ), catalog.detailColors );
					}
					if ( finish ) SurfaceVariation.apply( parts, finish );
					appearances.set( finish?.id ?? 'original', parts );
				}
				this.add( spec, appearances );
			}
			return this;
		} catch ( error ) { this.dispose(); throw error; }
	}
	add( spec, appearances, collision ) {
		const parts = appearances.values().next().value, bounds = new THREE.Box3(), lowBounds = new THREE.Box3();
		for ( const variant of appearances.values() ) for ( const part of variant ) {
			this.owned.add( part.geometry );
			part.geometry.computeBoundingBox(); bounds.union( part.geometry.boundingBox );
			const positions = part.geometry.attributes.position;
			for ( let i = 0; i < positions.count; i ++ ) if ( positions.getY( i ) <= 3 ) lowBounds.expandByPoint( new THREE.Vector3().fromBufferAttribute( positions, i ) );
		}
		const size = bounds.getSize( new THREE.Vector3() ).toArray();
		const collider = collision ?? ( spec.kind === 'tree' ? solidBox( [ 0.32, 2.7, 0.32 ] )
			: [ 'bag', 'litter' ].includes( spec.kind ) ? null : solidBox( size, bounds.getCenter( new THREE.Vector3() ).toArray() ) );
		if ( collider ) this.owned.add( collider );
		this.models.set( spec.id, { ...spec, parts, appearances, bounds, lowBounds, size, collider } );
	}
	material( role, finish ) {
		const detail = Boolean( catalog.detailColors[ role ] );
		const id = detail ? 'detail' : `${role}:${finish?.id ?? 'original'}`;
		if ( this.materials.has( id ) ) return this.materials.get( id );
		const binding = ( detail ? null : finish?.materials?.[ role ] ) ?? catalog.materials[ detail ? 'paint' : role ];
		let material = this.factory.build( binding.key, binding.variant );
		if ( detail || finish ) { material = material.clone(); material.vertexColors = true; this.owned.add( material ); }
		this.materials.set( id, material );
		return material;
	}
	get( id ) { return this.models.get( id ); }
	dispose() {
		for ( const resource of this.owned ) resource.dispose();
		this.owned.clear(); this.imported.dispose(); this.models.clear();
	}
}
