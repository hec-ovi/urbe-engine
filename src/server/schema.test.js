import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

describe( 'launcher route schema', () => {

	it( 'compiles with every referenced browser and persistence schema', async () => {

		const ajv = new Ajv2020( { allErrors: true, strict: true } );
		for ( const path of [
			'../launcher/schema/catalog.schema.json',
			'../launcher/schema/launcher-api.schema.json',
			'../library/schema/game-descriptor.schema.json',
			'../library/schema/npc-state.schema.json',
			'../game/agents/schema/values.schema.json',
			'../game/agents/schema/continuity-save.schema.json',
			'../game/quests/schema/values.schema.json',
			'../game/quests/schema/transit-state.schema.json',
			'../../../simulation/src/schemas/simulation-save.schema.json',
			'../game/persistence/schema/values.schema.json',
			'../game/persistence/schema/save-current-payload.schema.json',
			'../creation/schema/generate-city.schema.json',
			'../creation/schema/generate-instances.schema.json',
			'../creation/schema/generate-quests.schema.json',
			'../creation/schema/create-game.schema.json'
		] ) ajv.addSchema( await schema( path ) );

		const route = await schema( './schema/launcher-request.schema.json' );
		expect( () => ajv.compile( route ) ).not.toThrow();
		const validate = ajv.getSchema( route.$id );
		expect( validate( { method: 'saveCurrent', input: {} } ) ).toBe( false );
		expect( validate( { method: 'catalog' } ) ).toBe( true );

	} );

	it( 'compiles the closed NPC dialogue route schemas', async () => {

		const ajv = new Ajv2020( { allErrors: true, strict: true } );
		for ( const path of [
			'./schema/talk-request.schema.json',
			'./schema/talk-response.schema.json',
			'./schema/talk-error.schema.json'
		] ) {

			const value = await schema( path );
			expect( () => ajv.compile( value ) ).not.toThrow();

		}

	} );

} );

async function schema( relative ) {

	return JSON.parse( await readFile( new URL( relative, import.meta.url ), 'utf8' ) );

}
