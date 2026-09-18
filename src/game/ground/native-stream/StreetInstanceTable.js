import { DataTexture, FloatType, InterpolationSamplingMode, InterpolationSamplingType, NearestFilter, RGBAFormat, RedIntegerFormat, UnsignedIntType } from 'three/webgpu';
import { Fn, drawIndex, float, instanceIndex, int, ivec2, texture, textureLoad, textureSize, varying } from 'three/tsl';

/** Four floats per texel; the tint and the wear are the row every surface starts with. */
const TEXEL = 4;

const blank = () => {

	const image = new DataTexture( new Float32Array( TEXEL ), 1, 1, RGBAFormat, FloatType );
	Object.assign( image, { minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false } );
	image.needsUpdate = true;

	return image;

};

/**
 * The instance a batch is drawing, read through the same indirect table three's
 * own batching reads its matrix from: the draw the hardware is on names a slot,
 * and the slot names the copy.
 */
const batchInstance = Fn( ( [ indirect ], builder ) => {

	const drawn = int( builder.getDrawIndex() === null ? instanceIndex : drawIndex );
	const size = int( textureSize( textureLoad( indirect ), 0 ).x ).toConst();

	return textureLoad( indirect, ivec2( drawn.mod( size ), drawn.div( size ) ) ).x;

} );

/**
 * One surface's shader values, one row per copy standing in its batch.
 *
 * A batch draws every copy of one surface in a single call, so a value that
 * changes per placement can live neither in the geometry, which the copies
 * share, nor in the material, which is the batch's. It lives in this table: an
 * RGBA float row per instance slot, written when the copy is admitted and read
 * back in the shader at the row the batch's indirect table points at.
 *
 * Every row starts with the tint and the wear. A surface that samples the scan
 * atlas keeps the placement's UV offset and scale in the texel after it; a
 * display face that letters text keeps its glyph count there and one glyph
 * index per texel from then on.
 */
export class StreetInstanceTable {

	/**
	 * @param scan whether this surface samples the scan atlas
	 * @param glyphs how many glyph slots a display face letters, 0 for every other surface
	 */
	constructor( { scan = false, glyphs = 0 } = {} ) {

		this.scan = scan;
		this.glyphs = glyphs;
		this.header = 1 + ( scan || glyphs ? 1 : 0 );
		this.texels = this.header + glyphs;
		this.rows = 0;
		this.image = blank();
		this.values = texture( this.image );
		// Until the batch stands there is nothing to resolve a slot against.
		this.placeholder = new DataTexture( new Uint32Array( 1 ), 1, 1, RedIntegerFormat, UnsignedIntType );
		this.indirect = texture( this.placeholder );
		this.batch = null;
		this.row = varying( float( batchInstance( this.indirect ) ) )
			.setInterpolation( InterpolationSamplingType.FLAT, InterpolationSamplingMode.EITHER );
		this.ports = this.#ports();

	}

	/** Takes the batch whose copies this table answers for. */
	bind( batch ) {

		this.batch = batch;
		this.#fit();

	}

	/**
	 * The batch's tables as they stand now.
	 *
	 * Growing a batch throws its indirect table away and installs a new one, and
	 * a window reserves room in every batch it will touch before the first copy
	 * of it is admitted. Admission then runs in slices with frames in between,
	 * and a cancelled window may never write that batch again, so the table is
	 * told to look again at the reservation and not only when a copy is written.
	 */
	follow() {

		if ( this.batch ) this.#fit();

	}

	/**
	 * The values one copy draws with, at the slot its batch handed it.
	 * A slot is reused once its copy is dropped, so every texel is written.
	 */
	write( instance, placement ) {

		this.#fit();

		const data = this.image.image.data;
		const at = instance * this.texels * TEXEL;
		const [ r, g, b ] = placement.tint ?? [ 1, 1, 1 ];
		data[ at ] = r; data[ at + 1 ] = g; data[ at + 2 ] = b; data[ at + 3 ] = placement.wear ?? 0;
		if ( this.scan ) {

			const { offset, scale } = placement.scan ?? { offset: [ 0, 0 ], scale: [ 1, 1 ] };
			data.set( [ ...offset, ...scale ], at + TEXEL );

		}
		if ( this.glyphs ) {

			const text = placement.text ?? [];
			data[ at + TEXEL ] = Math.min( text.length, this.glyphs );
			for ( let slot = 0; slot < this.glyphs; slot ++ ) data[ at + ( this.header + slot ) * TEXEL ] = text[ slot ] ?? 0;

		}
		this.image.needsUpdate = true;

	}

	dispose() {

		this.image.dispose();
		this.placeholder.dispose();
		this.batch = null;

	}

	/** What this surface's effect samples, with the defaults a silent placement means. */
	#ports() {

		const head = this.#texel( int( 0 ) ), tail = this.header > 1 ? this.#texel( int( 1 ) ) : null;

		return {
			tint: head.rgb,
			wear: head.a,
			...( this.scan ? { scan: { offset: tail.xy, scale: tail.zw } } : {} ),
			...( this.glyphs ? { text: { count: tail.x, glyph: index => this.#texel( int( this.header ).add( index ) ).x } } : {} )
		};

	}

	/** One texel of the row this copy draws from, addressed the way the table is filled. */
	#texel( column ) {

		const size = int( textureSize( textureLoad( this.values ), 0 ).x ).toConst();
		const address = int( this.row.add( 0.5 ) ).mul( this.texels ).add( column ).toConst();

		return textureLoad( this.values, ivec2( address.mod( size ), address.div( size ) ) );

	}

	/**
	 * Room for every slot the batch can hand out. A batch grows by replacing its
	 * own textures and disposing its material, which is what makes the renderer
	 * build the draw again, so the table follows in the same step and the
	 * rebuilt draw reads both new tables. A texel keeps its address whatever the
	 * square measures, so the copies already standing carry over as they lie.
	 */
	#fit() {

		if ( this.indirect.value !== this.batch.mesh._indirectTexture ) this.indirect.value = this.batch.mesh._indirectTexture;
		if ( this.rows >= this.batch.capacity ) return;

		const size = Math.ceil( Math.sqrt( this.batch.capacity * this.texels ) );
		const data = new Float32Array( size * size * TEXEL );
		data.set( this.image.image.data.subarray( 0, this.rows * this.texels * TEXEL ) );
		const image = new DataTexture( data, size, size, RGBAFormat, FloatType );
		Object.assign( image, { minFilter: NearestFilter, magFilter: NearestFilter, generateMipmaps: false } );
		image.needsUpdate = true;

		this.image.dispose();
		this.image = image;
		this.values.value = image;
		this.rows = this.batch.capacity;

	}

}
