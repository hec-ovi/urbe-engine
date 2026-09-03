import { readFileSync } from 'node:fs';
import AjvModule from 'ajv/dist/2020.js';

const Ajv2020 = AjvModule.default ?? AjvModule;

const EXTERIOR_REQUEST = new URL( '../../../exterior/schemas/building-request.schema.json', import.meta.url );
const INTERIOR_REQUEST = new URL( '../../../interior/schemas/request.schema.json', import.meta.url );
const INTERIOR_BLUEPRINT = new URL( '../../../interior/schemas/blueprint.schema.json', import.meta.url );
const WORLD_MANIFEST = new URL( './schema/world-manifest.schema.json', import.meta.url );
const ROOFTOP_SPAN = new URL( '../../../connections/schemas/rooftop-span.schema.json', import.meta.url );
const ROOFTOP_SPAN_OUTPUT = new URL( '../../../connections/schemas/rooftop-span-output.schema.json', import.meta.url );

let ajv = null;

function loadSchema( url ) {

	return JSON.parse( readFileSync( url, 'utf8' ) );

}

function instance() {

	if ( ! ajv ) {

		ajv = new Ajv2020( { allErrors: true } );
		const rooftopSpanOutput = loadSchema( ROOFTOP_SPAN_OUTPUT );
		rooftopSpanOutput.properties.spans.items.$ref = './rooftop-span';
		ajv.addSchema( loadSchema( INTERIOR_BLUEPRINT ) );
		ajv.addSchema( loadSchema( INTERIOR_REQUEST ) );
		ajv.addSchema( loadSchema( EXTERIOR_REQUEST ) );
		ajv.addSchema( loadSchema( ROOFTOP_SPAN ) );
		ajv.addSchema( rooftopSpanOutput );
		ajv.addSchema( loadSchema( WORLD_MANIFEST ) );

	}

	return ajv;

}

/** @returns [] when valid, else ajv error objects. */
export function validateWorldManifest( manifest ) {

	const validate = instance().getSchema( 'urbe/engine/world-manifest' );

	return validate( manifest ) ? [] : validate.errors;

}

/** @returns [] when valid, else ajv error objects. */
export function validateExteriorRequest( request ) {

	const validate = instance().getSchema( 'urbe/exterior/building-request' );

	return validate( request ) ? [] : validate.errors;

}

/** @returns [] when valid, else ajv error objects. */
export function validateInteriorRequest( request ) {

	const validate = instance().getSchema( 'urbe/interior/request' );

	return validate( request ) ? [] : validate.errors;

}

/** The longest marquee text exterior's request schema accepts, in characters. */
export function marqueeTextLimit() {

	const { oneOf } = instance().getSchema( 'urbe/exterior/building-request' ).schema.properties.options.properties.signage;

	return oneOf.find( ( shape ) => shape.properties?.mode?.const === 'marquee' ).properties.text.maxLength;

}
