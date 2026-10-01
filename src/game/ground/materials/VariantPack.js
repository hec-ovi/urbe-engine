/**
 * Packs one variant set into two texture-array payloads, a layer per variant:
 * `color` holds basecolor RGB (sRGB, alpha 255) and `response` the normal's
 * X and Y in R and G, roughness in B and AO in A, all linear. Rows are stored
 * bottom first, so sampling the arrays at the surface's own UVs lands where
 * the catalog's `flipY` maps do.
 *
 * A layer whose maps cannot be read takes the fallback variant's pixels, and
 * says so; a set whose fallback cannot be read fails.
 *
 * @param request `{ width, height, fallback, layers: [{ id, maps: { basecolor, normal, roughness, ao }: { url, sha256 } }] }`
 * @param decode `( bytes, width, height ) => RGBA bytes`, top row first
 * @param read `url => bytes`
 * @param digest `bytes => hex sha256`, or null to skip the hash check
 */
export async function packVariants( { width, height, fallback, layers }, { decode, read, digest } ) {

	const size = width * height * 4;
	const color = new Uint8Array( size * layers.length ), response = new Uint8Array( size * layers.length );
	const failed = [], mismatched = [];
	// One layer at a time, so a set never holds more than four decoded maps at once.
	const ok = [];
	for ( const [ index, layer ] of layers.entries() ) ok.push( await ( async () => {

		try {

			const pixels = {};
			for ( const [ slot, map ] of Object.entries( layer.maps ) ) {

				const bytes = await read( map.url );
				if ( digest && map.sha256 && await digest( bytes ) !== map.sha256 ) mismatched.push( `${layer.id}/${slot}` );
				pixels[ slot ] = await decode( bytes, width, height );

			}
			fill( color, response, index, pixels, width, height );
			return true;

		} catch ( error ) {

			failed.push( `${layer.id}: ${error?.message ?? error}` );
			return false;

		}

	} )() );
	if ( ! ok[ fallback ] ) throw new Error( `the fallback variant could not be read (${failed.join( '; ' )})` );
	for ( const [ index, loaded ] of ok.entries() ) {

		if ( loaded ) continue;
		color.copyWithin( index * size, fallback * size, ( fallback + 1 ) * size );
		response.copyWithin( index * size, fallback * size, ( fallback + 1 ) * size );

	}

	return { color, response, failed, mismatched };

}

function fill( color, response, layer, { basecolor, normal, roughness, ao }, width, height ) {

	const base = layer * width * height * 4;
	for ( let row = 0; row < height; row ++ ) {

		// The file's top row is the texture's last.
		const from = row * width * 4, to = base + ( height - 1 - row ) * width * 4;
		for ( let x = 0; x < width * 4; x += 4 ) {

			color[ to + x ] = basecolor[ from + x ];
			color[ to + x + 1 ] = basecolor[ from + x + 1 ];
			color[ to + x + 2 ] = basecolor[ from + x + 2 ];
			color[ to + x + 3 ] = 255;
			response[ to + x ] = normal[ from + x ];
			response[ to + x + 1 ] = normal[ from + x + 1 ];
			response[ to + x + 2 ] = roughness[ from + x ];
			response[ to + x + 3 ] = ao[ from + x ];

		}

	}

}

/** A browser's PNG decoder: the file's own pixels at the catalog's size, with no colour conversion. */
export async function decodePng( bytes, width, height ) {

	const bitmap = await createImageBitmap( new Blob( [ bytes ], { type: 'image/png' } ), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' } );
	if ( bitmap.width !== width || bitmap.height !== height ) {

		bitmap.close();
		throw new Error( `${bitmap.width} x ${bitmap.height}, the catalog says ${width} x ${height}` );

	}
	const canvas = new OffscreenCanvas( width, height );
	const context = canvas.getContext( '2d', { willReadFrequently: true } );
	context.drawImage( bitmap, 0, 0 );
	bitmap.close();

	return context.getImageData( 0, 0, width, height ).data;

}
