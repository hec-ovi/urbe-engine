import * as THREE from 'three/webgpu';

const FIRST_CAPACITY = 64;
/** Past this many named slices, one upload of the live region costs less. */
const MAX_RANGES = 64;

/**
 * Every copy of one kit piece in the city, drawn once per surface it wears.
 *
 * The surfaces of a piece share one slot index and one pair of instance
 * buffers: a matrix written once is what all of them draw with, and the
 * renderer uploads it once however many material buckets the piece has. Each
 * write also names the slice it touched, so admitting a cell re-uploads those
 * slots instead of the whole city's matrices. Removal swaps the last instance
 * into the freed slot and tells that instance's owner where it moved, which
 * keeps the buffer dense without any per-cell compaction pass.
 */
export class KitPieceDraw {

	/** @param surfaces [{ bucket, geometry, material }] */
	constructor( name, surfaces ) {

		this.name = name;
		this.surfaces = surfaces;
		this.owners = [];
		this.count = 0;
		this.capacity = FIRST_CAPACITY;
		this.matrices = instanceBuffer( FIRST_CAPACITY, 16 );
		this.colors = instanceBuffer( FIRST_CAPACITY, 3, 1 );
		this.group = new THREE.Group();
		this.group.name = `kit:${name}`;
		this.meshes = surfaces.map( ( surface ) => this.#mesh( surface ) );
		for ( const mesh of this.meshes ) this.group.add( mesh );

	}

	/**
	 * @param owner a record this draw owns the `slot` field of
	 * @returns the same owner, with its slot written
	 */
	add( matrix, color, owner ) {

		if ( this.count === this.capacity ) this.#grow( this.capacity * 2 );

		const slot = this.count ++;
		matrix.toArray( this.matrices.array, slot * 16 );
		color.toArray( this.colors.array, slot * 3 );
		owner.draw = this;
		owner.slot = slot;
		this.owners[ slot ] = owner;
		this.#published( slot );

		return owner;

	}

	/** Frees this owner's slot, moving the last instance into it. */
	remove( owner ) {

		const slot = owner.slot;
		if ( slot < 0 || this.owners[ slot ] !== owner ) return;

		const last = -- this.count;
		if ( slot !== last ) {

			this.matrices.array.copyWithin( slot * 16, last * 16, last * 16 + 16 );
			this.colors.array.copyWithin( slot * 3, last * 3, last * 3 + 3 );
			this.owners[ slot ] = this.owners[ last ];
			this.owners[ slot ].slot = slot;

		}
		this.owners.length = this.count;
		owner.slot = - 1;
		this.#published( slot === last ? - 1 : slot );

	}

	/** Instance buffers are this draw's; geometry and materials are the kit's. */
	dispose() {

		for ( const mesh of this.meshes ) mesh.dispose();
		this.group.clear();
		this.group.removeFromParent();
		this.meshes = [];
		this.owners = [];
		this.count = 0;

	}

	#mesh( { bucket, geometry, material } ) {

		const mesh = new THREE.InstancedMesh( geometry, material, 0 );
		mesh.name = `kit:${this.name}:${bucket}`;
		// Every surface of the piece reads the one buffer pair this draw keeps.
		mesh.instanceMatrix = this.matrices;
		mesh.instanceColor = this.colors;
		mesh.count = this.count;
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		// One bounding sphere would have to cover every copy in the city, so a
		// frustum test on the batch can only ever answer "visible". Skipping it
		// saves the sphere rebuild on every admission and answers the same.
		mesh.frustumCulled = false;

		return mesh;

	}

	/**
	 * A cell wanted more copies than the buffers hold. The shader bakes the
	 * buffer length in, so the surfaces move to meshes the renderer has not
	 * compiled for yet.
	 */
	#grow( capacity ) {

		const matrices = instanceBuffer( capacity, 16 );
		const colors = instanceBuffer( capacity, 3, 1 );
		matrices.array.set( this.matrices.array );
		colors.array.set( this.colors.array );
		this.matrices = matrices;
		this.colors = colors;
		this.capacity = capacity;
		this.meshes = this.meshes.map( ( previous, index ) => {

			const mesh = this.#mesh( this.surfaces[ index ] );
			previous.dispose();
			previous.removeFromParent();
			this.group.add( mesh );

			return mesh;

		} );

	}

	/** @param slot the one that changed, or -1 when only the count did */
	#published( slot ) {

		for ( const mesh of this.meshes ) mesh.count = this.count;
		if ( slot < 0 ) return;

		touch( this.matrices, slot * 16, 16, this.count * 16 );
		touch( this.colors, slot * 3, 3, this.count * 3 );

	}

}

function instanceBuffer( capacity, itemSize, fill = 0 ) {

	const array = new Float32Array( capacity * itemSize );
	if ( fill ) array.fill( fill );
	const attribute = new THREE.InstancedBufferAttribute( array, itemSize );
	attribute.setUsage( THREE.DynamicDrawUsage );

	return attribute;

}

/**
 * Names the slice one write touched, so the upload carries that much and not
 * the whole city. A cell appends its copies into consecutive slots, so they
 * run together into one slice; a list that has grown past its worth collapses
 * into the live region, which is still one upload and still a superset.
 */
function touch( attribute, start, count, live ) {

	const ranges = attribute.updateRanges;
	const last = ranges[ ranges.length - 1 ];

	attribute.needsUpdate = true;

	if ( last && start >= last.start && start + count <= last.start + last.count ) return;
	if ( last && last.start + last.count === start ) {

		last.count += count;
		return;

	}
	if ( ranges.length >= MAX_RANGES ) {

		attribute.clearUpdateRanges();
		attribute.addUpdateRange( 0, Math.max( live, start + count ) );
		return;

	}
	attribute.addUpdateRange( start, count );

}
