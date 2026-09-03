import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

async function schema( name ) {

	return JSON.parse( await readFile( new URL( `./schema/${ name }`, import.meta.url ), 'utf8' ) );

}

describe( 'launcher schemas', () => {

	it( 'compile together and enforce the catalog and generation boundaries', async () => {

		const catalog = await schema( 'catalog.schema.json' );
		const api = await schema( 'launcher-api.schema.json' );
		const ajv = new Ajv2020( { allErrors: true, strict: true } );
		ajv.addSchema( catalog );
		ajv.addSchema( api );

		const validCatalog = ajv.getSchema( 'urbe/engine/launcher/catalog' );
		expect( validCatalog( { games: [ { id: 'g1', name: 'Night' } ], cities: [ { id: 'c1', name: 'Rain', size: 'small' } ] } ) ).toBe( true );
		expect( validCatalog( { games: [ { id: '', name: 'Night' } ], cities: [] } ) ).toBe( false );

		const validInstances = ajv.compile( { $ref: 'urbe/engine/launcher/api#/$defs/generateInstancesInput' } );
		expect( validInstances( { cityId: 'c1', mode: 'manual', count: 1, buildingIds: [ 'p11' ] } ) ).toBe( true );
		expect( validInstances( { cityId: 'c1', mode: 'manual', count: 0, buildingIds: [] } ) ).toBe( false );

	} );

} );
