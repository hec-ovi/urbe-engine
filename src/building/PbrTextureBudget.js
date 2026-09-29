/** Resizes decoded maps before their first upload without replacing texture objects. */
export class PbrTextureBudget {

	constructor( maxSize ) {

		if ( maxSize !== undefined && ( ! Number.isSafeInteger( maxSize ) || maxSize < 1 ) ) {

			throw Object.assign( new Error( 'textureMaxSize must be a positive integer' ), { code: 'E_PBR_TEXTURE_BUDGET' } );

		}
		this.maxSize = maxSize;

	}

	fit( texture ) {

		if ( this.maxSize === undefined ) return;
		if ( texture.isCompressedTexture ) return this.#dropLevels( texture );
		const image = texture.image;
		const width = image?.naturalWidth ?? image?.width;
		const height = image?.naturalHeight ?? image?.height;
		if ( ! width || ! height ) throw new Error( 'Decoded texture has no image dimensions' );
		const scale = Math.min( 1, this.maxSize / Math.max( width, height ) );
		if ( scale === 1 ) return;
		const targetWidth = Math.max( 1, Math.round( width * scale ) );
		const targetHeight = Math.max( 1, Math.round( height * scale ) );
		const canvas = typeof OffscreenCanvas === 'function'
			? new OffscreenCanvas( targetWidth, targetHeight )
			: Object.assign( document.createElement( 'canvas' ), { width: targetWidth, height: targetHeight } );
		const context = canvas.getContext( '2d', { alpha: true } );
		if ( ! context ) throw new Error( 'Texture resize canvas is unavailable' );
		context.imageSmoothingEnabled = true;
		context.imageSmoothingQuality = 'high';
		context.drawImage( image, 0, 0, targetWidth, targetHeight );
		texture.image = canvas;
		texture.needsUpdate = true;

	}

	/**
	 * A compressed map cannot be redrawn smaller, but it carries its own
	 * smaller levels: the ones above the budget are dropped and the first
	 * that fits becomes the map. A level that is not whole 4x4 blocks cannot
	 * lead a block-compressed chain, so the drop stops before one.
	 */
	#dropLevels( texture ) {

		const levels = texture.mipmaps ?? [];
		let first = 0;
		while ( first + 1 < levels.length && Math.max( levels[ first ].width, levels[ first ].height ) > this.maxSize ) {

			const next = levels[ first + 1 ];
			if ( next.width % 4 !== 0 || next.height % 4 !== 0 ) break;
			first ++;

		}
		if ( first === 0 ) return;
		texture.mipmaps = levels.slice( first );
		texture.image = { width: levels[ first ].width, height: levels[ first ].height };
		texture.needsUpdate = true;

	}

}
