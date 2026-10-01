import { decals, equaliseChannel, frames, masks, resample } from './DetailMasks.js';

/** The procedural fields are drawn at this size and resampled to the packed one. */
const DRAWN = 256;

/**
 * Packs the two RGBA fields the layer samples, a channel per mask: each
 * channel a catalog map names is read from that map's red channel, the rest
 * from the procedural stand-ins. A world-space mask (`equalise`) is spread
 * evenly over 0..255 by its own histogram, so the shader's thresholds cover
 * the same share of a surface whichever source it came from; a slab frame
 * keeps its values, whose zero is its untouched middle.
 *
 * @param request `{ size, cell, masks: [url|null x4], frames: [url|null x4], decals: boolean }`
 * @param decode `(url, size) => Promise<RGBA bytes>`, or null where no image can be decoded
 * @returns `{ masks, frames, decals, read: { masks, frames }, failed }`, `read` naming per channel `catalog` or `procedural`
 */
export async function pack( { size, cell, masks: maskUrls, frames: frameUrls, decals: drawDecals }, decode ) {

	const failed = [];
	const fill = async ( base, urls, even ) => {

		const out = resample( base, DRAWN, size );
		const read = [];
		for ( let channel = 0; channel < 4; channel ++ ) {

			const url = urls[ channel ];
			read.push( 'procedural' );
			if ( ! url ) continue;
			if ( ! decode ) {

				failed.push( `${url}: no image decoder here` );
				continue;

			}
			try {

				const image = await decode( url, size );
				for ( let index = 0; index < size * size; index ++ ) out[ index * 4 + channel ] = image[ index * 4 ];
				if ( even[ channel ] ) equaliseChannel( out, channel );
				read[ channel ] = 'catalog';

			} catch ( error ) {

				failed.push( `${url}: ${error?.message ?? error}` );

			}

		}

		return { out, read };

	};

	const world = await fill( masks( DRAWN ), maskUrls, [ true, true, true, true ] );
	const slab = await fill( frames( DRAWN ), frameUrls, [ false, false, true, false ] );

	return {
		masks: world.out, frames: slab.out, decals: drawDecals ? decals( cell ) : null,
		read: { masks: world.read, frames: slab.read }, failed
	};

}

/** A browser's decoder: the file's pixels, resized to `size` square, straight from the file with no colour conversion. */
export async function decodeImage( url, size ) {

	const response = await fetch( url );
	if ( ! response.ok ) throw new Error( `HTTP ${response.status}` );
	const bitmap = await createImageBitmap( await response.blob(), {
		resizeWidth: size, resizeHeight: size, resizeQuality: 'high', colorSpaceConversion: 'none', premultiplyAlpha: 'none'
	} );
	const canvas = new OffscreenCanvas( size, size );
	const context = canvas.getContext( '2d', { willReadFrequently: true } );
	context.drawImage( bitmap, 0, 0 );
	bitmap.close();

	return context.getImageData( 0, 0, size, size ).data;

}
