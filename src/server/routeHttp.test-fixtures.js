/** A mebibyte of spaces, sent again and again so a body can pass a route's cap without being held whole. */
const MEBIBYTE = new Uint8Array( 1024 * 1024 ).fill( 0x20 );

/** Sends `bytes` bytes of body to `url`, streamed a mebibyte at a time. @returns the fetch response */
export function sendBytes( url, method, bytes ) {

	let sent = 0;
	const body = new ReadableStream( {
		pull( controller ) {

			if ( sent >= bytes ) return controller.close();
			const size = Math.min( MEBIBYTE.length, bytes - sent );
			controller.enqueue( MEBIBYTE.subarray( 0, size ) );
			sent += size;

		}
	} );
	return fetch( url, { method, body, duplex: 'half', headers: { 'Content-Type': 'application/json' } } );

}
