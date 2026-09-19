import * as THREE from 'three/webgpu';

/** Where a mesh publishes its channel for the material that reads it. */
export const FILL_CHANNEL = Symbol.for( 'urbe.fill-channel' );

/**
 * One vec4 of light per copy of a draw, kept in a texture the shader reads
 * by instance id.
 *
 * A batch or instanced draw carries one matrix and one tint per copy and
 * nothing else, and a tint multiplies a surface where a room's fill has to be
 * added to it. So a draw that stands in rooms keeps this beside its matrices:
 * a copy is written at its slot, moves when the draw compacts, and the texture
 * grows with the draw's capacity, in the same square layout the batch keeps
 * its own colours in. Every mesh of the draw publishes the channel under
 * `FILL_CHANNEL`, and a material built against one of those meshes reads the
 * texture the channel holds at that moment.
 */
export class FillChannel {

	constructor( capacity ) {

		this.texture = null;
		this.grow( capacity );

	}

	/** The channel a mesh publishes, if it stands in one. */
	static of( mesh ) {

		return mesh[ FILL_CHANNEL ] ?? null;

	}

	attach( mesh ) {

		mesh[ FILL_CHANNEL ] = this;

		return this;

	}

	/** @param fill Vector4 */
	set( slot, fill ) {

		fill.toArray( this.texture.image.data, slot * 4 );
		this.texture.needsUpdate = true;

	}

	/** A compacted draw moves its last copy into the freed slot. */
	move( from, to ) {

		this.texture.image.data.copyWithin( to * 4, from * 4, from * 4 + 4 );
		this.texture.needsUpdate = true;

	}

	/** Room for this many copies; what was written stays at its slot. */
	grow( capacity ) {

		const size = Math.ceil( Math.sqrt( Math.max( 1, capacity ) ) );
		const data = new Float32Array( size * size * 4 );
		if ( this.texture ) {

			data.set( this.texture.image.data.subarray( 0, Math.min( data.length, this.texture.image.data.length ) ) );
			this.texture.dispose();

		}
		this.texture = new THREE.DataTexture( data, size, size, THREE.RGBAFormat, THREE.FloatType );
		this.texture.needsUpdate = true;

	}

	dispose() {

		this.texture.dispose();

	}

}
