import { BatchedMesh } from 'three/webgpu';

/** Enough copies for a first cell; a cell that wants more grows it. */
const FIRST_CAPACITY = 64;

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
	 */
	constructor( name, material, { vertices, indices = 0, instances = FIRST_CAPACITY, castShadow = false } ) {

		this.name = name;
		this.material = material;
		this.count = 0;
		/** True once a copy has carried a colour, which the shader only reads from then on. */
		this.coloured = false;
		this.mesh = new BatchedMesh( Math.max( 1, instances ), vertices, indices, material );
		this.mesh.name = name;
		this.mesh.perObjectFrustumCulled = true;
		this.mesh.sortObjects = Boolean( material.transparent );
		this.mesh.castShadow = castShadow;
		this.mesh.receiveShadow = true;
		// One sphere around the whole batch can only ever answer "visible", and
		// the batch draws in world coordinates, so the object test is skipped
		// and the per-copy test is what culls.
		this.mesh.frustumCulled = false;

	}

	get capacity() {

		return this.mesh.maxInstanceCount;

	}

	/** One primitive, held once for the whole city. @returns its geometry id */
	addGeometry( geometry ) {

		return this.mesh.addGeometry( geometry );

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
		this.rebuild();

	}

	/** Drops the draws built against buffers this batch has replaced. */
	rebuild() {

		this.material.dispose();

	}

	/** Draws one more copy of one primitive. @returns the instance to hand back */
	add( geometryId, matrix, color = null ) {

		this.reserve( 1 );

		const instance = this.mesh.addInstance( geometryId );
		this.mesh.setMatrixAt( instance, matrix );
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

		this.mesh.dispose();
		this.mesh.removeFromParent();
		this.count = 0;

	}

}
