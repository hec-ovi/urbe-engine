import { decodePng, packVariants } from './VariantPack.js';

const read = async ( url ) => {

	const response = await fetch( url );
	if ( ! response.ok ) throw new Error( `HTTP ${response.status}` );

	return response.arrayBuffer();

};

const digest = async ( bytes ) => [ ...new Uint8Array( await crypto.subtle.digest( 'SHA-256', bytes ) ) ]
	.map( ( byte ) => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );

/** Packs one variant set off the main thread: a request in, `{ color, response, failed, mismatched }` (or `{ error }`) out. */
self.onmessage = async ( { data } ) => {

	try {

		const packed = await packVariants( data, { decode: decodePng, read, digest: globalThis.crypto?.subtle ? digest : null } );
		self.postMessage( packed, [ packed.color.buffer, packed.response.buffer ] );

	} catch ( error ) {

		self.postMessage( { error: String( error?.message ?? error ) } );

	}

};
