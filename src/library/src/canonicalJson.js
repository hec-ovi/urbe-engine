/** JSON text with recursively sorted object keys and one trailing newline. */
export function canonicalJson( value ) {

	return `${JSON.stringify( canonicalValue( value ), null, 2 )}\n`;

}

export function canonicalClone( value ) {

	return JSON.parse( canonicalJson( value ) );

}

function canonicalValue( value ) {

	if ( Array.isArray( value ) ) return value.map( canonicalValue );
	if ( ! isPlainObject( value ) ) return value;

	const result = {};
	for ( const key of Object.keys( value ).sort( compareStrings ) ) result[ key ] = canonicalValue( value[ key ] );
	return result;

}

export function compareStrings( left, right ) {

	return left < right ? - 1 : left > right ? 1 : 0;

}

function isPlainObject( value ) {

	if ( value === null || typeof value !== 'object' ) return false;
	const prototype = Object.getPrototypeOf( value );
	return prototype === Object.prototype || prototype === null;

}
