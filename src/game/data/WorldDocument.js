import { openWorldArchive } from '../../world-archive/browser.js';

/** Reads one checked JSON document or its bounded collection archive. */
export async function readWorldDocument( url, { encoding, sha256, projection } = {} ) {

	const response = await fetch( url );
	const type = ( response.headers?.get( 'content-type' ) ?? '' ).split( ';', 1 )[ 0 ].toLowerCase();
	if ( ! response.ok ) throw new Error( `${url}: HTTP ${response.status}` );
	if ( type && type !== 'application/json' ) throw new Error( `${url}: expected JSON, received ${type}` );

	let bytes, data;
	try {

		bytes = await response.arrayBuffer();
		data = JSON.parse( new TextDecoder( 'utf-8', { fatal: true } ).decode( bytes ) );

	} catch ( error ) {

		throw new Error( `${url}: invalid JSON (${error.message})` );

	}
	if ( sha256 && await documentHash( bytes ) !== sha256 ) throw new Error( `${url}: document byte hash mismatch` );
	if ( encoding !== 'archive' ) return { bytes, data };

	// The archive reader receives the same index bytes whose manifest hash passed.
	const archive = await openWorldArchive( url, {
		fetch: ( path, options ) => String( path ) === String( url )
			? Promise.resolve( new Response( bytes, { headers: { 'content-type': 'application/json' } } ) )
			: fetch( path, options )
	} );
	const selected = projection?.( archive.index );
	return { bytes, data: selected ? await archive.readProjection( selected ) : await archive.read(), archive };

}

export async function documentHash( bytes ) {

	const digest = await crypto.subtle.digest( 'SHA-256', bytes );
	return Array.from( new Uint8Array( digest ), ( byte ) => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );

}
