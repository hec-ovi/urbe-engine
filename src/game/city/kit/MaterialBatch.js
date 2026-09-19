import { BatchedMesh, Vector4 } from 'three/webgpu';
import { FillChannel } from './FillChannel.js';

/** Enough copies for a first cell; a cell that wants more grows it. */
const FIRST_CAPACITY = 64;
/** A copy admitted without a fill stands dark. */
const NO_FILL = new Vector4();

/**
 * Every primitive that wears one material, drawn as one batch.
 *
 * The renderer compiles a pipeline per material and per vertex layout, not per
 * mesh, so a city that draws one mesh per piece primitive pays that compile
 * over and over for the same program. A batch holds each primitive's geometry
 * once and each copy as `(geometry id, matrix)`, which is one pipeline, one
 * bind group and one vertex buffer for every piece that wears the material.
 *
 * Culling stays per copy: the batch's own bounding sphere would cover the whole
 * city, so the object test is off and `perObjectFrustumCulled` answers for each
 * copy against that copy's geometry. Opaque batches do not sort, because depth
 * ordering only pays where blending needs it.
 */
export class MaterialBatch {

	/**
	 * @param vertices total vertices of every primitive this material wears
	 * @param indices their total index count, or 0 when the geometry is not indexed
	 * @param instances copies to make room for before the first cell stands
	 * @param fill whether each copy carries a fill light (FillChannel)
	 */
	constructor( name, material, { vertices, indices = 0, instances = FIRST_CAPACITY, castShadow = false, fill = false, hitches = null } ) {

		this.name = name;
		this.material = material;
		this.hitches = hitches;
		this.count = 0;
		/** What the geometry buffers hold room for, and what is written into them. */
		this.vertexCapacity = Math.max( 1, vertices );
		this.indexCapacity = indices;
		this.vertices = 0;
		this.indices = 0;
		/** True once a copy has carried a colour, which the shader only reads from then on. */
		this.coloured = false;
		this.mesh = new BatchedMesh( Math.max( 1, instances ), this.vertexCapacity, this.indexCapacity, material );
		this.mesh.name = name;
		this.mesh.perObjectFrustumCulled = true;
		this.mesh.sortObjects = Boolean( material.transparent );
		this.mesh.castShadow = castShadow;
		this.mesh.receiveShadow = true;
		// One sphere around the whole batch can only ever answer "visible", and
		// the batch draws in world coordinates, so the object test is skipped
		// and the per-copy test is what culls.
		this.mesh.frustumCulled = false;
		this.fill = fill ? new FillChannel( this.capacity ).attach( this.mesh ) : null;

	}

	get capacity() {

		return this.mesh.maxInstanceCount;

	}

	/**
	 * The one attribute layout this batch draws from, fixed by the geometry that
	 * filled it first: a batch has one buffer per attribute and is indexed or
	 * not as a whole, so everything written into it later has to match.
	 */
	get layout() {

		const geometry = this.mesh.geometry;

		return {
			indexed: Boolean( geometry.getIndex() ),
			attributes: new Map( Object.entries( geometry.attributes ).map( ( [ name, attribute ] ) => [ name, {
				itemSize: attribute.itemSize, type: attribute.array.constructor, normalized: attribute.normalized
			} ] ) )
		};

	}

	/**
	 * Room for this many more copies, in one reallocation.
	 *
	 * Growing hands the mesh new matrix, indirect and colour textures and throws
	 * the old ones away, and a shader that is already built holds the textures it
	 * was built against. Three rebuilds a draw when the material it was built
	 * from is disposed, so the batch disposes its own material and the next frame
	 * builds every pass again, the shadow pass included, against the live
	 * textures. The material itself stays exactly as it is and keeps drawing.
	 */
	reserve( copies ) {

		const wanted = this.count + copies;
		if ( wanted <= this.capacity ) return;

		this.mesh.setInstanceCount( Math.max( wanted, this.capacity * 2 ) );
		this.fill?.grow( this.capacity );
		this.rebuild();

	}

	/**
	 * Room for this much more geometry, in one reallocation.
	 *
	 * A city reads a building plan the first time one of its copies is admitted,
	 * so a batch keeps taking new primitives for as long as the city is played.
	 * Doubling makes that a handful of reallocations over the whole city instead
	 * of one per plan, and each one copies the vertices already written into the
	 * new buffers at the same offsets, so the geometry ids stay what they were.
	 */
	reserveGeometry( vertices, indices ) {

		const wantedVertices = this.vertices + vertices;
		const wantedIndices = this.indices + indices;
		if ( wantedVertices <= this.vertexCapacity && wantedIndices <= this.indexCapacity ) return;

		if ( wantedVertices > this.vertexCapacity ) this.vertexCapacity = Math.max( wantedVertices, this.vertexCapacity * 2 );
		if ( wantedIndices > this.indexCapacity ) this.indexCapacity = Math.max( wantedIndices, this.indexCapacity * 2 );
		this.mesh.setGeometrySize( this.vertexCapacity, this.indexCapacity );
		this.rebuild();

	}

	/**
	 * Drops the draws built against buffers this batch has replaced. The next
	 * frame that draws the batch builds its graph again, which is the cost the
	 * note names; its program stays compiled behind the warm-up's keeper.
	 */
	rebuild() {

		this.hitches?.note( `${this.name} rebuilt` );
		this.material.dispose();

	}

	/** One primitive, held once for the whole city. @returns its geometry id */
	addGeometry( geometry ) {

		this.vertices += geometry.getAttribute( 'position' ).count;
		this.indices += geometry.getIndex()?.count ?? 0;

		return this.mesh.addGeometry( geometry );

	}

	/** Draws one more copy of one primitive. @returns the instance to hand back */
	add( geometryId, matrix, color = null, fill = null ) {

		this.reserve( 1 );

		const instance = this.mesh.addInstance( geometryId );
		this.mesh.setMatrixAt( instance, matrix );
		this.fill?.set( instance, fill ?? NO_FILL );
		if ( color ) {

			this.mesh.setColorAt( instance, color );
			// The colour texture is born with the first coloured copy, and a shader
			// built before it exists never reads a colour again.
			if ( ! this.coloured ) {

				this.coloured = true;
				this.rebuild();

			}

		}
		this.count ++;

		return instance;

	}

	remove( instance ) {

		this.mesh.deleteInstance( instance );
		this.count --;

	}

	/** The batch owns its buffers; geometry and material are the kit's. */
	dispose() {

		this.fill?.dispose();
		this.mesh.dispose();
		this.mesh.removeFromParent();
		this.count = 0;

	}

}
