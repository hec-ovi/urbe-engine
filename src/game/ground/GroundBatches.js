import * as THREE from 'three/webgpu';

const capacity = value => 2 ** Math.ceil( Math.log2( Math.max( 16, value ) ) );

/** Resident templates upload once per material; tile ownership stays independent. */
export class GroundBatches {

	constructor( group ) {

		this.group = group;
		this.batches = new Map();
		this.tiles = new Map();

	}

	add( tiles ) {

		const additions = new Map();
		for ( const [ id, tile ] of tiles ) {

			if ( this.tiles.has( id ) ) continue;
			const records = [];
			this.tiles.set( id, records );
			tile.group.updateMatrixWorld( true );
			tile.group.traverse( mesh => {

				if ( ! mesh.isMesh || ! mesh.geometry.getAttribute( 'position' ).count ) return;
				const key = `${mesh.material.uuid}:${mesh.castShadow}:${mesh.receiveShadow}`;
				if ( ! this.batches.has( key ) ) this.batches.set( key, new MaterialBatch( mesh ) );
				const batch = this.batches.get( key );
				if ( ! additions.has( batch ) ) additions.set( batch, [] );
				additions.get( batch ).push( { mesh, records } );

			} );

		}
		for ( const [ batch, sources ] of additions ) {

			batch.add( sources );
			if ( ! batch.mesh.parent ) this.group.add( batch.mesh );

		}
		return additions.size > 0;

	}

	show() {

		for ( const records of this.tiles.values() ) for ( const { batch, instances } of records ) {

			for ( const id of instances ) batch.mesh.setVisibleAt( id, true );

		}
		for ( const batch of this.batches.values() ) batch.mesh.computeBoundingSphere();

	}

	drop( id ) {

		for ( const { batch, geometry, instances } of this.tiles.get( id ) ?? [] ) batch.drop( geometry, instances );
		this.tiles.delete( id );

	}

	dispose() {

		for ( const batch of this.batches.values() ) { batch.mesh.removeFromParent(); batch.mesh.dispose(); }
		this.batches.clear();
		this.tiles.clear();

	}

}

class MaterialBatch {

	constructor( source ) {

		this.mesh = new THREE.BatchedMesh( 16, 16, 16, source.material );
		this.mesh.name = `ground:batch:${source.material.name || source.material.uuid}`;
		this.mesh.castShadow = source.castShadow;
		this.mesh.receiveShadow = source.receiveShadow;
		this.mesh.sortObjects = source.material.transparent;
		this.geometries = new Map();
		this.free = [];
		const parking = new THREE.BufferGeometry();
		parking.setAttribute( 'position', new THREE.Float32BufferAttribute( [ 0, 0, 0 ], 3 ) );
		parking.setAttribute( 'normal', new THREE.Float32BufferAttribute( [ 0, 1, 0 ], 3 ) );
		parking.setAttribute( 'uv', new THREE.Float32BufferAttribute( [ 0, 0 ], 2 ) );
		parking.setIndex( [ 0, 0, 0 ] );
		this.parking = this.mesh.addGeometry( parking );
		parking.dispose();
		this.vertices = 1;
		this.indices = 3;
		this.fragmented = false;

	}

	add( sources ) {

		const unique = new Set();
		let vertices = this.vertices, indices = this.indices, instances = this.mesh.instanceCount - this.free.length;
		for ( const { mesh } of sources ) {

			instances += mesh.isInstancedMesh ? mesh.count : 1;
			if ( this.geometries.has( mesh.geometry ) || unique.has( mesh.geometry ) ) continue;
			unique.add( mesh.geometry );
			vertices += mesh.geometry.getAttribute( 'position' ).count;
			indices += mesh.geometry.index?.count ?? mesh.geometry.getAttribute( 'position' ).count;

		}
		if ( instances > this.mesh.maxInstanceCount ) this.mesh.setInstanceCount( capacity( instances * 1.25 ) );
		if ( this.fragmented ) { this.mesh.optimize(); this.fragmented = false; }
		const vertexCapacity = this.mesh.geometry.getAttribute( 'position' )?.count ?? 16;
		const indexCapacity = this.mesh.geometry.index?.count ?? 16;
		if ( vertices > vertexCapacity || indices > indexCapacity ) {

			this.mesh.setGeometrySize( Math.max( vertexCapacity, capacity( vertices * 1.25 ) ), Math.max( indexCapacity, capacity( indices * 1.25 ) ) );

		}
		const matrix = new THREE.Matrix4(), instance = new THREE.Matrix4();
		for ( const { mesh, records } of sources ) {

			let geometry = this.geometries.get( mesh.geometry );
			if ( ! geometry ) {

				const view = indexedView( mesh.geometry );
				geometry = { id: this.mesh.addGeometry( view ), references: 0 };
				this.geometries.set( mesh.geometry, geometry );
				view.dispose();

			}
			geometry.references ++;
			const ids = [];
			for ( let i = 0; i < ( mesh.isInstancedMesh ? mesh.count : 1 ); i ++ ) {

				matrix.copy( mesh.matrixWorld );
				if ( mesh.isInstancedMesh ) { mesh.getMatrixAt( i, instance ); matrix.multiply( instance ); }
				const id = this.free.length ? this.free.pop() : this.mesh.addInstance( geometry.id );
				this.mesh.setGeometryIdAt( id, geometry.id );
				this.mesh.setMatrixAt( id, matrix );
				this.mesh.setVisibleAt( id, false );
				ids.push( id );

			}
			records.push( { batch: this, geometry: mesh.geometry, instances: ids } );

		}
		this.vertices = vertices;
		this.indices = indices;

	}

	drop( source, instances ) {

		// Keep our own free slots: Three's deleted-slot admission sorts its full free list per instance.
		for ( const id of instances ) {

			this.mesh.setVisibleAt( id, false );
			this.mesh.setGeometryIdAt( id, this.parking );
			this.free.push( id );

		}
		const geometry = this.geometries.get( source );
		if ( -- geometry.references ) return;
		this.mesh.deleteGeometry( geometry.id );
		this.geometries.delete( source );
		this.vertices -= source.getAttribute( 'position' ).count;
		this.indices -= source.index?.count ?? source.getAttribute( 'position' ).count;
		this.fragmented = true;

	}

}

/** All Ground surfaces carry physical UVs and normals; only index layout is normalized. */
function indexedView( source ) {

	const view = new THREE.BufferGeometry();
	for ( const name of [ 'position', 'normal', 'uv' ] ) view.setAttribute( name, source.getAttribute( name ) );
	view.setIndex( source.index ?? Array.from( { length: source.getAttribute( 'position' ).count }, ( _, i ) => i ) );
	view.boundingBox = source.boundingBox;
	view.boundingSphere = source.boundingSphere;
	return view;

}
