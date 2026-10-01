import { decodeImage, pack } from './DetailPack.js';

/** Packs the layer's fields off the main thread: a `pack` request in, its answer (or `{ error }`) out. */
self.onmessage = async ( { data } ) => {

	try {

		const decode = typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function' ? decodeImage : null;
		const packed = await pack( data, decode );
		self.postMessage( packed, [ packed.masks.buffer, packed.frames.buffer, ...( packed.decals ? [ packed.decals.buffer ] : [] ) ] );

	} catch ( error ) {

		self.postMessage( { error: String( error?.message ?? error ) } );

	}

};
