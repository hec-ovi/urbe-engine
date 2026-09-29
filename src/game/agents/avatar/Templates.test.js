import { describe, expect, it } from 'vitest';
import { AvatarTemplates } from './Templates.js';
import { defaultRecipe, normalizeRecipe } from './Recipe.js';
import liaison from './templates/district-liaison.json' with { type: 'json' };

describe( 'authored characters', () => {

	it( 'loads every shipped template, by id and by name, and shares their outfits with the crowd', () => {

		const templates = new AvatarTemplates();

		expect( templates.list.map( ( entry ) => entry.name ) ).toEqual( [ 'District liaison', 'Metropolitan patrol', 'Night runner' ] );
		expect( templates.named( 'district-liaison' ) ).toBe( templates.named( 'District liaison' ) );
		expect( templates.named( 'District liaison' ).recipe ).toEqual( normalizeRecipe( liaison.recipe ) );
		expect( templates.named( 'Metropolitan patrol' ).recipe ).toBeNull();
		expect( templates.outfits.map( ( { outfit } ) => outfit.top ) ).toEqual( [ 'office-jacket', 'police-jacket', 'tech-top' ] );
		expect( templates.outfits.reduce( ( sum, { share } ) => sum + share, 0 ) ).toBeCloseTo( 0.11 );

	} );

	it( 'takes a studio export as it stands, names it after its file, and names people by npcId', () => {

		const recipe = defaultRecipe( 'superhero-male' );
		const templates = new AvatarTemplates( {
			'night-shift_warden': recipe,
			liaison: { name: 'Liaison', recipe: liaison.recipe, people: [ 'npc-7' ] }
		} );

		expect( templates.named( 'Night shift warden' ).recipe ).toEqual( recipe );
		expect( templates.named( 'Night shift warden' ).crowd ).toBe( 0 );
		expect( templates.forPerson( 'npc-7' ).name ).toBe( 'Liaison' );
		expect( templates.forPerson( 'npc-8' ) ).toBeNull();
		expect( templates.forPerson( null ) ).toBeNull();
		expect( templates.outfits ).toEqual( [] );

	} );

	it( 'refuses a template it could not dress anybody in', () => {

		const outfit = defaultRecipe().outfit;
		expect( () => new AvatarTemplates( { a: { name: 'A', outfit: { ...outfit, pants: 'kilt' } } } ) ).toThrow( /outfit.pants/ );
		expect( () => new AvatarTemplates( { a: { name: 'A', outfit, recipe: liaison.recipe } } ) ).toThrow( /either/ );
		expect( () => new AvatarTemplates( { a: { name: 'A', outfit, people: [ 'npc-1' ] } } ) ).toThrow( /outfit/ );
		expect( () => new AvatarTemplates( { a: { name: 'A', outfit, crowd: 0.6 } } ) ).toThrow( /share/ );
		expect( () => new AvatarTemplates( {
			a: { name: 'A', outfit, crowd: 0.3 }, b: { name: 'B', outfit, crowd: 0.3 }
		} ) ).toThrow( /more than/ );
		expect( () => new AvatarTemplates( {
			a: { name: 'A', recipe: liaison.recipe, people: [ 'npc-1' ] }, b: { name: 'B', recipe: liaison.recipe, people: [ 'npc-1' ] }
		} ) ).toThrow( /both/ );

	} );

} );
