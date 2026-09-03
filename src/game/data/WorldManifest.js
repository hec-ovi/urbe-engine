const KEYS = new Set( [
	'contractVersion', 'seed', 'atlasVersion', 'named', 'namingTheme', 'parcels', 'interiors', 'floors'
] );
const FLOOR_TAG = /^-?[0-9]{3}$/;

/** Runtime validation of assembly's world-manifest schema plus atlas relations. */
export function worldManifestErrors( manifest, knownParcels ) {

	const errors = [];
	if ( ! plainObject( manifest ) ) return [ 'manifest must be an object' ];

	for ( const key of KEYS ) if ( ! Object.hasOwn( manifest, key ) ) errors.push( `missing ${key}` );
	for ( const key of Object.keys( manifest ) ) if ( ! KEYS.has( key ) ) errors.push( `unknown property ${key}` );
	if ( manifest.contractVersion !== '1.0.0' ) errors.push( 'contractVersion must be 1.0.0' );
	if ( typeof manifest.seed !== 'string' || ! manifest.seed ) errors.push( 'seed must be a non-empty string' );
	if ( typeof manifest.atlasVersion !== 'string' || ! manifest.atlasVersion ) errors.push( 'atlasVersion must be a non-empty string' );
	if ( typeof manifest.named !== 'boolean' ) errors.push( 'named must be boolean' );
	if ( manifest.namingTheme !== null && typeof manifest.namingTheme !== 'string' ) errors.push( 'namingTheme must be string or null' );

	const parcels = stringSet( manifest.parcels, 'parcels', errors );
	const interiors = stringSet( manifest.interiors, 'interiors', errors );
	if ( parcels && knownParcels ) for ( const id of parcels ) if ( ! knownParcels.has( id ) ) errors.push( `parcel ${id} is not in the blueprint` );
	if ( parcels && interiors ) for ( const id of interiors ) if ( ! parcels.has( id ) ) errors.push( `interior ${id} has no shell parcel` );

	if ( ! plainObject( manifest.floors ) ) errors.push( 'floors must be an object' );
	else {

		const floorIds = new Set( Object.keys( manifest.floors ) );
		for ( const [ id, tags ] of Object.entries( manifest.floors ) ) {

			if ( ! Array.isArray( tags ) || ! tags.length || tags.some( ( tag ) => typeof tag !== 'string' || ! FLOOR_TAG.test( tag ) ) ) {

				errors.push( `floors.${id} must contain floor tags` );

			} else if ( new Set( tags ).size !== tags.length ) errors.push( `floors.${id} contains duplicates` );

		}
		if ( interiors ) {

			for ( const id of interiors ) if ( ! floorIds.has( id ) ) errors.push( `interior ${id} lists no floors` );
			for ( const id of floorIds ) if ( ! interiors.has( id ) ) errors.push( `floors.${id} is not an interior` );

		}

	}

	return errors;

}

function stringSet( value, name, errors ) {

	if ( ! Array.isArray( value ) || value.some( ( entry ) => typeof entry !== 'string' || ! entry ) ) {

		errors.push( `${name} must be an array of non-empty strings` );
		return null;

	}
	const values = new Set( value );
	if ( values.size !== value.length ) errors.push( `${name} contains duplicates` );

	return values;

}

function plainObject( value ) {

	return Boolean( value ) && typeof value === 'object' && ! Array.isArray( value );

}
