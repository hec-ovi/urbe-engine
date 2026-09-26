import { Group } from 'three/webgpu';
import { prepare } from './BatchGeometry.js';
import { MaterialBatch } from './MaterialBatch.js';
import { HIDDEN_FAR } from './SphereCulledBatch.js';

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
 *
 * A kit that reads its pieces as the city needs them hands them over in as many
 * calls as it likes: the batches grow to take them and the draw count does not.
 *
 * A surface may also carry `far`, the geometry it draws past `lod.distance`
 * from `lod.point`; a far geometry with no triangles draws nothing out there.
 * One that arrives after its entry was added joins through `addFar`, and the
 * copies already standing draw it from then on.
 */
export class MaterialBatches {

	/**
	 * @param fill whether each copy carries a fill light, for draws standing in rooms
	 * @param hitches the log a batch names its rebuilds in
	 * @param lod `{ point, distance }` the far surfaces are chosen by, shared with the caller
	 */
	constructor( name, { fill = false, uvRepeat = false, hitches = null, lod = null } = {} ) {

		this.name = name;
		this.fill = fill;
		this.uvRepeat = uvRepeat;
		this.hitches = hitches;
		this.lod = lod;
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
	 * Takes these entries into the batch each material owns: a material this kit
	 * has not drawn yet gets a batch holding exactly the vertices and indices of
	 * the primitives handed over, and one it already draws grows to hold them
	 * beside what is standing. The draw count follows the materials, so entries
	 * arriving later never add a batch a material already has.
	 *
	 * @param entries [{ id, surfaces: [{ bucket, geometry, material, castShadow?, far? }] }]
	 * @param castShadow whether this kit's batches cast, unless a surface says otherwise
	 * @param instances copies each new batch makes room for before the first cell
	 */
	add( entries, { castShadow = false, instances } = {} ) {

		const byMaterial = new Map();

		for ( const entry of entries ) {

			for ( const surface of entry.surfaces ) {

				if ( ! byMaterial.has( surface.bucket ) ) byMaterial.set( surface.bucket, [] );
				byMaterial.get( surface.bucket ).push( surface );

			}

		}

		// Every geometry is made to fit before any batch is touched, so entries
		// that cannot be batched leave the standing city exactly as it was.
		for ( const [ key, surfaces ] of byMaterial ) {

			// A batch is filled from the geometries as they come out of here, and
			// every owner of a surface reads it from the same record, so the
			// prepared geometry is written back over the one that was handed in.
			const held = drawn( surfaces );
			const ready = prepare( held.map( ( [ surface, field ] ) => surface[ field ] ), this.batches.get( key )?.layout ?? null );
			for ( const [ index, [ surface, field ] ] of held.entries() ) surface[ field ] = ready[ index ];

		}

		for ( const [ key, surfaces ] of byMaterial ) {

			const vertices = total( surfaces, ( geometry ) => geometry.getAttribute( 'position' ).count );
			const indices = total( surfaces, ( geometry ) => geometry.getIndex()?.count ?? 0 );
			const standing = this.batches.get( key );

			if ( standing ) {

				standing.reserveGeometry( vertices, indices );
				continue;

			}

			const batch = new MaterialBatch( `${this.name}:${key}`, surfaces[ 0 ].material, {
				vertices, indices,
				castShadow: surfaces.every( ( surface ) => surface.castShadow ?? castShadow ),
				instances,
				fill: this.fill,
				uvRepeat: this.uvRepeat,
				hitches: this.hitches,
				lod: this.lod
			} );
			this.batches.set( key, batch );
			this.group.add( batch.mesh );

		}

		for ( const entry of entries ) {

			this.entries.set( entry.id, entry.surfaces.map( ( surface ) => {

				const batch = this.batches.get( surface.bucket );
				const geometryId = batch.addGeometry( surface.geometry );
				if ( surface.far ) batch.setFar( geometryId, farId( batch, surface.far ) );

				return { batch, geometryId };

			} ) );

		}

		return this;

	}

	/**
	 * The far geometry an entry's surfaces carry now and did not when it was
	 * added, each joining the batch its near surface draws from. Every copy of
	 * the entry, standing or still to come, draws it past the far distance. A far
	 * geometry that cannot join its batch throws before any batch is touched.
	 *
	 * @param surfaces the entry's surfaces, in the order `add` took them
	 */
	addFar( id, surfaces ) {

		const parts = this.entries.get( id );
		const joining = surfaces.flatMap( ( surface, index ) => ( surface.far ? [ [ parts[ index ], surface ] ] : [] ) );

		for ( const [ { batch }, surface ] of joining ) {

			if ( hasTriangles( surface.far ) ) [ surface.far ] = prepare( [ surface.far ], batch.layout );

		}
		for ( const [ { batch, geometryId }, surface ] of joining ) {

			if ( hasTriangles( surface.far ) ) batch.reserveGeometry( surface.far.getAttribute( 'position' ).count, surface.far.getIndex()?.count ?? 0 );
			batch.setFar( geometryId, farId( batch, surface.far ) );

		}

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
	admit( id, matrix, color = null, fill = null, uvRepeat = [ 1, 1 ] ) {

		const parts = this.entries.get( id );
		const instances = [];

		for ( const { batch, geometryId } of parts ) instances.push( batch.add( geometryId, matrix, color, fill, uvRepeat ) );
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

/** Every geometry a batch holds for these surfaces, as [surface, field]: each near one, and each far one with triangles. */
function drawn( surfaces ) {

	return surfaces.flatMap( ( surface ) => [
		[ surface, 'geometry' ],
		...( surface.far && hasTriangles( surface.far ) ? [ [ surface, 'far' ] ] : [] )
	] );

}

function total( surfaces, of ) {

	return drawn( surfaces ).reduce( ( sum, [ surface, field ] ) => sum + of( surface[ field ] ), 0 );

}

/** The id a far geometry draws under in its batch, added there, or HIDDEN_FAR for one with no triangles. */
function farId( batch, far ) {

	return hasTriangles( far ) ? batch.addGeometry( far ) : HIDDEN_FAR;

}

function hasTriangles( geometry ) {

	return ( geometry.getIndex()?.count ?? geometry.getAttribute( 'position' )?.count ?? 0 ) > 0;

}
