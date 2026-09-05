import { readFileSync } from 'node:fs';

/** Registers local schema files and their file-relative dependency closure. */
export class SchemaFiles {

	constructor( ajv ) {

		this.ajv = ajv;
		this.files = new Map();
		this.keys = new Map();

	}

	add( url, key ) {

		let schema = this.files.get( url.href );

		if ( schema ) {

			this.#register( schema, key );
			return;

		}

		schema = JSON.parse( readFileSync( url, 'utf8' ) );
		this.files.set( url.href, schema );
		this.#register( schema, key );
		this.#dependencies( schema, url, '' );

	}

	#register( schema, key = schema.$id ) {

		if ( this.keys.get( key ) === schema ) return;
		this.ajv.addSchema( schema, key );
		this.keys.set( key, schema );

	}

	#dependencies( value, url, baseId ) {

		if ( value === null || typeof value !== 'object' ) return;

		const resolve = this.ajv.opts.uriResolver.resolve;
		const id = value.$id ? resolve( baseId, value.$id ) : baseId;
		const file = value.$ref?.split( '#' )[ 0 ];

		if ( file?.endsWith( '.json' ) ) {

			this.add( new URL( file, url ), resolve( id, file ) );

		}

		for ( const child of Object.values( value ) ) this.#dependencies( child, url, id );

	}

}
