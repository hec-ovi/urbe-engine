/** Adds runtime errors for one Connections rooftop span document. */
export function rooftopSpanErrors( document, parcels, errors ) {

	if ( ! plainObject( document ) ) {

		errors.push( 'rooftopSpans must be an object' );
		return;

	}
	metaErrors( document.meta, errors );
	if ( ! Array.isArray( document.spans ) ) {

		errors.push( 'rooftopSpans.spans must be an array' );
		return;

	}
	const ids = new Set();
	for ( let index = 0; index < document.spans.length; index ++ ) {

		const span = document.spans[ index ];
		const prefix = `rooftopSpans.spans[${index}]`;
		if ( ! plainObject( span ) ) {

			errors.push( `${prefix} must be an object` );
			continue;

		}
		if ( typeof span.id !== 'string' || ! span.id ) errors.push( `${prefix}.id must be a non-empty string` );
		else if ( ids.has( span.id ) ) errors.push( `rooftop span ${span.id} is duplicated` );
		else ids.add( span.id );

		for ( const end of [ 'a', 'b' ] ) endpointErrors( span[ end ], `${prefix}.${end}`, parcels, errors );
		if ( ! Array.isArray( span.path ) || span.path.length < 3 || span.path.length > 129
			|| span.path.some( ( point ) => ! vector( point, 3 ) ) ) errors.push( `${prefix}.path must contain 3 to 129 finite 3D points` );
		if ( ! positive( span.thickness ) ) errors.push( `${prefix}.thickness must be positive` );
		if ( ! finite( span.sag ) || span.sag < 0 ) errors.push( `${prefix}.sag must be non-negative` );
		if ( ! positive( span.slack ) ) errors.push( `${prefix}.slack must be positive` );
		if ( ! finite( span.slackRatio ) || span.slackRatio <= 1 ) errors.push( `${prefix}.slackRatio must exceed 1` );
		if ( ! positive( span.length ) ) errors.push( `${prefix}.length must be positive` );
		catenaryErrors( span.catenary, `${prefix}.catenary`, errors );

	}

}

function metaErrors( meta, errors ) {

	if ( ! plainObject( meta ) ) {

		errors.push( 'rooftopSpans.meta must be an object' );
		return;

	}
	if ( typeof meta.seed !== 'string' || ! meta.seed ) errors.push( 'rooftopSpans.meta.seed must be a non-empty string' );
	if ( meta.schemaVersion !== '1.0.0' ) errors.push( 'rooftopSpans.meta.schemaVersion must be 1.0.0' );
	if ( typeof meta.generatorVersion !== 'string' || ! meta.generatorVersion ) errors.push( 'rooftopSpans.meta.generatorVersion must be a non-empty string' );

}

function endpointErrors( endpoint, path, parcels, errors ) {

	if ( ! plainObject( endpoint ) ) {

		errors.push( `${path} must be an endpoint` );
		return;

	}
	if ( typeof endpoint.buildingId !== 'string' || ! endpoint.buildingId ) errors.push( `${path}.buildingId must be a non-empty string` );
	else if ( parcels && ! parcels.has( endpoint.buildingId ) ) errors.push( `${path}.buildingId is not a shell parcel` );
	if ( typeof endpoint.attachmentId !== 'string' || ! endpoint.attachmentId ) errors.push( `${path}.attachmentId must be a non-empty string` );
	if ( ! vector( endpoint.position, 3 ) ) errors.push( `${path}.position must be a finite 3D point` );

}

function catenaryErrors( catenary, path, errors ) {

	if ( ! plainObject( catenary ) || catenary.type !== 'catenary' ) {

		errors.push( `${path} must be a catenary` );
		return;

	}
	if ( ! vector( catenary.groundOrigin, 2 ) ) errors.push( `${path}.groundOrigin must be a finite 2D point` );
	if ( ! vector( catenary.horizontalDirection, 2 ) ) errors.push( `${path}.horizontalDirection must be a finite 2D vector` );
	if ( ! positive( catenary.horizontalDistance ) ) errors.push( `${path}.horizontalDistance must be positive` );
	if ( ! positive( catenary.scale ) ) errors.push( `${path}.scale must be positive` );
	if ( ! finite( catenary.horizontalOffset ) || ! finite( catenary.verticalOffset ) ) errors.push( `${path} offsets must be finite` );
	if ( ! Array.isArray( catenary.domain ) || catenary.domain.length !== 2
		|| catenary.domain[ 0 ] !== 0 || ! positive( catenary.domain[ 1 ] ) ) errors.push( `${path}.domain must start at zero and end above zero` );

}

function vector( value, length ) {

	return Array.isArray( value ) && value.length === length && value.every( finite );

}

function positive( value ) {

	return finite( value ) && value > 0;

}

function finite( value ) {

	return typeof value === 'number' && Number.isFinite( value );

}

function plainObject( value ) {

	return Boolean( value ) && typeof value === 'object' && ! Array.isArray( value );

}
