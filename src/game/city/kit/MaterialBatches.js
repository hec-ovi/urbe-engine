import { Group } from 'three/webgpu';
import { prepare } from './BatchGeometry.js';
import { MaterialBatch } from './MaterialBatch.js';

/**
 * One kit's whole vocabulary, drawn as one batch per material.
 *
 * Building pieces, street pieces and room modules all arrive the same way: an
 * entry is a piece, a piece is a list of primitives, and a primitive is a
 * geometry wearing one material. Every primitive of one material goes into that
 * material's batch whatever piece it came from, so the draws follow the
 * materials the kit publishes and not the number of pieces or the amount of
 * city standing. Admitting a copy appends `(geometry id, matrix)` per primitive
 * to batches that already exist; dropping it takes those instances back out.
 */
export class MaterialBatches {

	constructor( name ) {

		this.name = name;
		/** material key to MaterialBatch */
		this.batches = new Map();
		/** entry id to [{ batch, geometryId }] */
		this.entries = new Map();
		this.group = new Group();
		this.group.name = name;
		this.copies = 0;

	}

	/** One draw per material, for the whole city. */
	get batchCount() {

		return this.batches.size;

	}

	/** How many primitive instances are standing, over every batch. */
	get instanceCount() {

		let total = 0;
		for ( const batch of this.batches.values() ) total += batch.count;

		return total;

	}

	has( id ) {

		return this.entries.has( id );

	}

	/**
	 * Builds every batch this kit needs, over every entry at once: a batch holds
	 * exactly the vertices and indices of the primitives that wear its material.
	 *
	 * @param entries [{ id, surfaces: [{ bucket, geometry, material, castShadow? }] }]
	 * @param castShadow whether this kit's batches cast, unless a surface says otherwise
	 * @param instances copies each batch makes room for before the first cell
	 */
	build( entries, { castShadow = false, instances } = {} ) {

		const byMaterial = new Map();

		for ( const entry of entries ) {

			for ( const surface of entry.surfaces ) {

				if ( ! byMaterial.has( surface.bucket ) ) byMaterial.set( surface.bucket, [] );
				byMaterial.get( surface.bucket ).push( surface );

			}

		}

		for ( const [ key, surfaces ] of byMaterial ) {

			// A batch is filled from the geometries as they come out of here, and
			// every owner of a surface reads it from the same record, so the
			// prepared geometry is written back over the one that was handed in.
			const ready = prepare( surfaces.map( ( surface ) => surface.geometry ) );
			for ( const [ index, surface ] of surfaces.entries() ) surface.geometry = ready[ index ];

			this.batches.set( key, new MaterialBatch( `${this.name}:${key}`, surfaces[ 0 ].material, {
				vertices: total( surfaces, ( geometry ) => geometry.getAttribute( 'position' ).count ),
				indices: total( surfaces, ( geometry ) => geometry.getIndex()?.count ?? 0 ),
				castShadow: surfaces.every( ( surface ) => surface.castShadow ?? castShadow ),
				instances
			} ) );

		}

		for ( const entry of entries ) {

			this.entries.set( entry.id, entry.surfaces.map( ( surface ) => {

				const batch = this.batches.get( surface.bucket );

				return { batch, geometryId: batch.addGeometry( surface.geometry ) };

			} ) );

		}

		for ( const batch of this.batches.values() ) this.group.add( batch.mesh );

		return this;

	}

	/**
	 * Room for the copies a cell is about to append, one reallocation per batch.
	 * @param ids every entry the cell places, repeats included
	 */
	reserve( ids ) {

		const wanted = new Map();

		for ( const id of ids ) {

			for ( const { batch } of this.entries.get( id ) ?? [] ) wanted.set( batch, ( wanted.get( batch ) ?? 0 ) + 1 );

		}
		for ( const [ batch, copies ] of wanted ) batch.reserve( copies );

	}

	/** Draws one more copy of an entry. @returns a handle to hand back to `release` */
	admit( id, matrix, color = null ) {

		const parts = this.entries.get( id );
		const instances = [];

		for ( const { batch, geometryId } of parts ) instances.push( batch.add( geometryId, matrix, color ) );
		this.copies ++;

		return { parts, instances };

	}

	release( handle ) {

		for ( const [ index, { batch } ] of handle.parts.entries() ) batch.remove( handle.instances[ index ] );
		handle.instances.length = 0;
		this.copies --;

	}

	dispose() {

		for ( const batch of this.batches.values() ) batch.dispose();
		this.batches.clear();
		this.entries.clear();
		this.copies = 0;
		this.group.clear();
		this.group.removeFromParent();

	}

}

function total( surfaces, of ) {

	return surfaces.reduce( ( sum, surface ) => sum + of( surface.geometry ), 0 );

}
