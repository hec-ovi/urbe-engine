import { fail } from './NativeMaterialError.js';

export function requiredAttributes( effect ) {
	return Object.freeze( {
		position: 3, normal: 3,
		...( effect !== 'solid' ? { uv: 2 } : {} ),
		...( [ 'asphalt', 'parking', 'road-paint' ].includes( effect ) ? { _street_wear: 1 } : {} ),
		...( effect === 'cast-concrete' ? { _street_height: 1 } : {} )
	} );
}

export function assertAttributes( geometry, required ) {
	const count = geometry?.getAttribute?.( 'position' )?.count;
	if ( ! Number.isSafeInteger( count ) || count < 1 ) fail( 'Street geometry has no positions' );
	for ( const [ name, itemSize ] of Object.entries( required ) ) {
		const field = geometry.getAttribute( name );
		if ( ! field || field.itemSize !== itemSize || field.count !== count ) fail( `Invalid street geometry attribute: ${name}` );
	}
}
