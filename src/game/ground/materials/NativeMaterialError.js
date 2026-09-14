export function fail( message ) {
	throw Object.assign( new Error( message ), { code: 'E_STREET_MATERIAL' } );
}
