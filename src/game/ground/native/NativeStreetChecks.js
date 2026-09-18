export const hashValue = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test( value );
export const record = value => value !== null && typeof value === 'object' && ! Array.isArray( value );
export const vector = ( value, size ) => Array.isArray( value ) && value.length === size && value.every( Number.isFinite );
export const bounds = value => record( value ) && vector( value.min, 3 ) && vector( value.max, 3 ) && value.min.every( ( n, axis ) => n <= value.max[ axis ] );
export const pathValue = value => typeof value === 'string' && /^[a-zA-Z0-9._+/-]+$/.test( value ) && value.split( '/' ).every( part => part && part !== '.' && part !== '..' );

export function fail( message, cause ) {
	throw Object.assign( new Error( `E_WORLD_STREETS: ${message}` ), { code: 'E_WORLD_STREETS', ...( cause ? { cause } : {} ) } );
}

export function strings( values, field ) {
	if ( ! Array.isArray( values ) || values.some( value => typeof value !== 'string' || ! value ) || new Set( values ).size !== values.length ) fail( `Invalid ${field}` );
	return new Set( values );
}

export async function byteHash( bytes ) {
	const digest = await crypto.subtle.digest( 'SHA-256', bytes );
	return [ ...new Uint8Array( digest ) ].map( byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
}
export const jsonHash = value => byteHash( new TextEncoder().encode( JSON.stringify( value ) ) );

export function freeze( value ) {
	if ( value && typeof value === 'object' && ! Object.isFrozen( value ) ) {
		Object.freeze( value );
		for ( const child of Object.values( value ) ) freeze( child );
	}
	return value;
}
