import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

const names = [
	'config', 'generate-city', 'generate-instances', 'generate-quests', 'create-game',
	'city-result', 'instances-result', 'quests-result', 'game-result', 'creation-error'
];

describe( 'creation contract schemas', () => {

	it( 'compile together with their linked library result schemas', async () => {

		const ajv = new Ajv2020( { allErrors: true, strict: true } );
		const city = await document( '../library/schema/city-descriptor.schema.json' );
		const game = await document( '../library/schema/game-descriptor.schema.json' );
		for ( const dependency of [
			'../game/agents/schema/values.schema.json',
			'../game/agents/schema/continuity-save.schema.json',
			'../../../simulation/src/schemas/simulation-save.schema.json',
			'../library/schema/npc-state.schema.json'
		] ) ajv.addSchema( await document( dependency ) );
		ajv.addSchema( city );
		ajv.addSchema( game );

		for ( const name of names ) {

			const value = await document( `./schema/${ name }.schema.json` );
			expect( () => ajv.compile( value ) ).not.toThrow();

		}

	} );

	it( 'keeps automatic interiors and deterministic side jobs inside supported limits', async () => {

		const ajv = new Ajv2020( { allErrors: true, strict: true } );
		const instances = ajv.compile( await document( './schema/generate-instances.schema.json' ) );
		const quests = ajv.compile( await document( './schema/generate-quests.schema.json' ) );

		expect( instances( { cityId: 'city', mode: 'automatic', count: 9, buildingIds: [] } ) ).toBe( true );
		expect( instances( { cityId: 'city', mode: 'manual', count: 1, buildingIds: [] } ) ).toBe( false );
		expect( quests( { cityId: 'city', interiorIds: [ 'p0' ], mainBrief: '', sideJobs: 3 } ) ).toBe( true );
		expect( quests( { cityId: 'city', interiorIds: [ 'p0' ], mainBrief: '', sideJobs: 25 } ) ).toBe( false );

	} );

} );

async function document( relative ) {

	return JSON.parse( await readFile( new URL( relative, import.meta.url ), 'utf8' ) );

}
