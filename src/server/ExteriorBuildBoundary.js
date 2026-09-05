import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import AjvModule from 'ajv/dist/2020.js';

const Ajv2020 = AjvModule.default ?? AjvModule;

export class ExteriorBuildError extends Error {

	constructor( code, message, status = 500 ) {

		super( message );
		this.code = code;
		this.status = status;

	}

}

export class ExteriorBuildBoundary {

	constructor() {

		const ajv = new Ajv2020( { allErrors: true } );
		for ( const path of [
			'../../../connections/schemas/link.schema.json',
			'../../../connections/schemas/aperture.schema.json',
			'../../../connections/schemas/networks.schema.json',
			'../../../connections/schemas/output.schema.json',
			'../../../connections/schemas/rooftop-span.schema.json',
			'../../../connections/schemas/rooftop-span-output.schema.json',
			'../assembly/schema/world-manifest.schema.json',
			'./schema/exterior-build-error.schema.json'
		] ) ajv.addSchema( schema( path ) );
		this.request = ajv.compile( schema( './schema/exterior-build-request.schema.json' ) );
		this.manifest = ajv.getSchema( 'https://schemas.urbe.invalid/urbe/engine/world-manifest' );
		this.connections = ajv.getSchema( 'https://schemas.urbe.invalid/urbe/connections/output' );
		this.job = ajv.compile( schema( './schema/exterior-build-job.schema.json' ) );

	}

	check( input ) {

		if ( ! this.request( input ) ) throw new ExteriorBuildError( 'E_INVALID_REQUEST', 'expected an Atlas blueprint envelope with safe parcel ids', 400 );
		const ids = input.blueprint.parcels.map( ( parcel ) => parcel.id );
		if ( new Set( ids ).size !== ids.length ) throw new ExteriorBuildError( 'E_INVALID_REQUEST', 'parcel ids must be unique', 400 );

	}

}

function schema( path ) {

	return JSON.parse( readFileSync( new URL( path, import.meta.url ), 'utf8' ), ( key, value ) =>
		[ '$id', '$ref' ].includes( key ) && typeof value === 'string' && value.startsWith( 'urbe/' ) ? `https://schemas.urbe.invalid/${value}` : value );

}

export function blueprintHash( value ) {

	return byteHash( JSON.stringify( canonical( value ) ) );

}

export function byteHash( bytes ) {

	return createHash( 'sha256' ).update( bytes ).digest( 'hex' );

}

function canonical( value ) {

	if ( Array.isArray( value ) ) return value.map( canonical );
	if ( value && typeof value === 'object' ) return Object.fromEntries( Object.keys( value ).sort().map( ( key ) => [ key, canonical( value[ key ] ) ] ) );
	return value;

}
