import { describe, expect, it } from 'vitest';
import {
	DEFAULT_SHAPE, GARMENTS, SHAPE_LIMITS, SLOTS, defaultRecipe, hairstylesFor, nearSkin, normalizeRecipe,
	personRecipe, randomizeRecipe, recipeKey
} from './Recipe.js';

describe( 'character recipes', () => {

	it( 'draws the studio\'s person for a seed: the same body, hairstyle, outfit and skin it names', () => {

		// The studio's own generator gives this seed exactly these choices.
		const recipe = randomizeRecipe( defaultRecipe(), { seed: 3141592653, scope: 'all' } );

		expect( [ recipe.body, recipe.hair, recipe.outfit.top, recipe.outfit.pants, recipe.outfit.footwear, recipe.colors.skin ] ).toEqual( [
			'regular-male', 'Hairstyles/Rigged to Head Bone/Male/Hair_Buzzed.gltf', 'tech-top', 'pants-tech', 'boots-patrol', '#d8ad8d'
		] );
		const person = personRecipe( { gender: 'male', appearanceSeed: 3141592653 } );
		expect( { ...person, shape: null } ).toEqual( { ...recipe, shape: null } );
		expect( person.shape.height ).toBe( recipe.shape.height );
		expect( person.shape.faceWidth ).toBe( recipe.shape.faceWidth );

	} );

	it( 'keeps the people of a street near an ordinary build: no exaggerated seats, hips or thickness', () => {

		const seats = [];
		for ( let seed = 0; seed < 2000; seed ++ ) {

			const { shape } = personRecipe( { gender: seed % 2 ? 'female' : 'male', appearanceSeed: seed * 2654435761 >>> 0 } );
			seats.push( shape.glutes );
			for ( const key of [ 'glutes', 'hips', 'thighs', 'thickness', 'waist', 'build' ] ) {

				expect( shape[ key ] ).toBeGreaterThanOrEqual( 0.8 );
				expect( shape[ key ] ).toBeLessThanOrEqual( 1.2 );

			}

		}
		const mean = seats.reduce( ( sum, seat ) => sum + seat, 0 ) / seats.length;
		expect( Math.abs( mean - 1 ) ).toBeLessThan( 0.03 );
		expect( Math.max( ...seats ) ).toBeLessThanOrEqual( 1.15 );
		expect( seats.filter( ( seat ) => seat > 1.1 ).length / seats.length ).toBeLessThan( 0.1 );

	} );

	it( 'gives a person one recipe for their appearance seed, on the regular body of their gender, wherever it is asked', () => {

		for ( const appearanceSeed of [ 0, 7, 12345, 0xffffffff, 2 ** 31 + 5 ] ) {

			for ( const gender of [ 'male', 'female' ] ) {

				const recipe = personRecipe( { gender, appearanceSeed } );
				expect( personRecipe( { gender, appearanceSeed } ) ).toEqual( recipe );
				expect( recipe.body ).toBe( `regular-${gender}` );
				expect( hairstylesFor( recipe.body ) ).toContain( recipe.hair );
				expect( normalizeRecipe( recipe ) ).toEqual( recipe );
				expect( recipeKey( normalizeRecipe( recipe ) ) ).toBe( recipeKey( recipe ) );

			}

		}
		expect( recipeKey( personRecipe( { gender: 'male', appearanceSeed: 1 } ) ) ).not.toBe( recipeKey( personRecipe( { gender: 'male', appearanceSeed: 2 } ) ) );

	} );

	it( 'dresses a crowd in every garment, keeps every shape inside its limits and no top near the wearer\'s skin', () => {

		const worn = Object.fromEntries( SLOTS.map( ( slot ) => [ slot, new Set() ] ) );
		for ( let seed = 0; seed < 400; seed ++ ) {

			const recipe = personRecipe( { gender: seed % 2 ? 'female' : 'male', appearanceSeed: seed * 2654435761 >>> 0 } );
			for ( const slot of SLOTS ) worn[ slot ].add( recipe.outfit[ slot ] );
			for ( const [ key, value ] of Object.entries( recipe.shape ) ) {

				expect( value ).toBeGreaterThanOrEqual( SHAPE_LIMITS[ key ][ 0 ] );
				expect( value ).toBeLessThanOrEqual( SHAPE_LIMITS[ key ][ 1 ] );

			}
			expect( nearSkin( recipe.outfit.colors.top.primary, recipe.colors.skin ) ).toBe( false );

		}
		for ( const slot of SLOTS ) expect( [ ...worn[ slot ] ].sort() ).toEqual( [ ...GARMENTS[ slot ] ].sort() );

	} );

	it( 'shares authored outfits out to their share of the crowd, the rest of the person staying the seed\'s', () => {

		const outfit = normalizeRecipe( { ...defaultRecipe(), outfit: { ...defaultRecipe().outfit, top: 'police-jacket' } } ).outfit;
		let dressed = 0;
		for ( let seed = 0; seed < 2000; seed ++ ) {

			const own = personRecipe( { gender: 'female', appearanceSeed: seed } );
			const shared = personRecipe( { gender: 'female', appearanceSeed: seed }, { outfits: [ { outfit, share: 0.25 } ] } );
			expect( shared.shape ).toEqual( own.shape );
			expect( shared.colors ).toEqual( own.colors );
			if ( JSON.stringify( shared.outfit ) === JSON.stringify( outfit ) ) dressed ++;
			else expect( shared.outfit ).toEqual( own.outfit );

		}
		expect( dressed / 2000 ).toBeGreaterThan( 0.2 );
		expect( dressed / 2000 ).toBeLessThan( 0.3 );

	} );

	it( 'reads a studio export, clamps its shape, reads later controls as neutral and refuses what it cannot wear', () => {

		const recipe = defaultRecipe( 'teen-female' );
		const { eyeSize, ...legacy } = { ...recipe.shape, height: 2, glutes: 0.1 };
		const read = normalizeRecipe( { ...recipe, shape: legacy, extra: true } );

		expect( read.shape.height ).toBe( SHAPE_LIMITS.height[ 1 ] );
		expect( read.shape.glutes ).toBe( SHAPE_LIMITS.glutes[ 0 ] );
		expect( read.shape.eyeSize ).toBe( DEFAULT_SHAPE.eyeSize );
		expect( read ).not.toHaveProperty( 'extra' );
		expect( () => normalizeRecipe( { ...recipe, shape: { ...recipe.shape, legs: undefined } } ) ).toThrow( /shape.legs/ );
		expect( () => normalizeRecipe( { ...recipe, hair: 'Hairstyles/Rigged to Head Bone/Male/Hair_Mohawk.gltf' } ) ).toThrow( /hairstyle/ );
		expect( () => normalizeRecipe( { ...recipe, body: 'superhero-female' } ) ).toThrow( /body/ );
		expect( () => normalizeRecipe( { ...recipe, outfit: { ...recipe.outfit, top: 'cape' } } ) ).toThrow( /outfit.top/ );
		expect( () => normalizeRecipe( { ...recipe, colors: { ...recipe.colors, skin: 'tan' } } ) ).toThrow( /colors.skin/ );
		expect( () => normalizeRecipe( { ...recipe, version: 2 } ) ).toThrow( /version/ );
		expect( normalizeRecipe( { ...recipe, outfit: { ...recipe.outfit, top: 'none' } } ).outfit.top ).toBe( 'none' );

	} );

} );
