import { describe, expect, it } from 'vitest';
import {
	BUILD_KEYS, DEFAULT_SHAPE, GARMENTS, SHAPE_LIMITS, SLOTS, STREET_BUILDS, buildsOf, defaultRecipe, hairstylesFor, nearSkin,
	normalizeRecipe, personRecipe, randomizeRecipe, recipeKey
} from './Recipe.js';

describe( 'character recipes', () => {

	it( 'draws the studio\'s person for a seed: the same body, hairstyle, garments, face, height and skin it names', () => {

		// The studio's own generator gives this seed exactly these choices.
		const recipe = randomizeRecipe( defaultRecipe(), { seed: 3141592653, scope: 'all' } );

		expect( [ recipe.body, recipe.hair, recipe.outfit.top, recipe.outfit.pants, recipe.outfit.footwear, recipe.colors.skin ] ).toEqual( [
			'regular-male', 'Hairstyles/Rigged to Head Bone/Male/Hair_Buzzed.gltf', 'tech-top', 'pants-tech', 'boots-patrol', '#d8ad8d'
		] );
		const person = personRecipe( { gender: 'male', appearanceSeed: 3141592653 } );
		const garments = ( { outfit } ) => ( { ...outfit, colors: null } );
		expect( { ...person, shape: null, outfit: garments( person ) } ).toEqual( { ...recipe, shape: null, outfit: garments( recipe ) } );
		// Height is the studio's, spread wider on the street.
		expect( Math.sign( person.shape.height - 1 ) ).toBe( Math.sign( recipe.shape.height - 1 ) );
		expect( Math.abs( person.shape.height - 1 ) ).toBeGreaterThanOrEqual( Math.abs( recipe.shape.height - 1 ) );
		expect( person.shape.faceWidth ).toBe( recipe.shape.faceWidth );

	} );

	it( 'gives a street slim, average and broad people of an ordinary build, never heavy, short and tall, each build moving its controls together', () => {

		const builds = { upper: [], waist: [], lower: [] };
		const heights = [];
		for ( let seed = 0; seed < 2000; seed ++ ) {

			const { shape } = personRecipe( { gender: seed % 2 ? 'female' : 'male', appearanceSeed: seed * 2654435761 >>> 0 } );
			const amounts = buildsOf( shape );
			for ( const [ build, keys ] of Object.entries( BUILD_KEYS ) ) {

				const [ least, most ] = STREET_BUILDS[ build ].range;
				expect( amounts[ build ] ).toBeGreaterThanOrEqual( least - 1e-9 );
				expect( amounts[ build ] ).toBeLessThanOrEqual( most + 1e-9 );
				for ( const key of keys ) expect( shape[ key ] ).toBe( shape[ keys[ 0 ] ] );
				builds[ build ].push( amounts[ build ] );

			}
			expect( shape.shoulders - 1 ).toBeCloseTo( amounts.upper * 0.6, 2 );
			heights.push( shape.height );

		}
		const quantile = ( list, q ) => [ ...list ].sort( ( a, b ) => a - b )[ Math.floor( q * ( list.length - 1 ) ) ];
		const mean = ( list ) => list.reduce( ( sum, value ) => sum + value, 0 ) / list.length;
		// Slim and broad both show: the middle four fifths of the street spread a tenth of a unit and more.
		expect( quantile( builds.upper, 0.9 ) - quantile( builds.upper, 0.1 ) ).toBeGreaterThan( 0.1 );
		expect( quantile( builds.lower, 0.9 ) - quantile( builds.lower, 0.1 ) ).toBeGreaterThan( 0.08 );
		// Short and tall: the middle four fifths span seven hundredths of the frame's height.
		expect( quantile( heights, 0.9 ) - quantile( heights, 0.1 ) ).toBeGreaterThan( 0.07 );
		// Slimmer than the pack's athletic to heavy bodies on average, and no bellies.
		expect( mean( builds.upper ) ).toBeLessThan( 0 );
		expect( mean( builds.waist ) ).toBeLessThan( - 0.02 );
		expect( Math.max( ...builds.waist ) ).toBeLessThanOrEqual( 1e-9 );
		expect( Math.max( ...builds.lower ) ).toBeLessThanOrEqual( 0.01 + 1e-9 );

	} );

	it( 'colours a street\'s clothes apart: tops of many colours, most of them not near-black, trousers unlike the top', () => {

		const lightness = ( hex ) => {

			const [ r, g, b ] = hex.slice( 1 ).match( /../g ).map( ( channel ) => parseInt( channel, 16 ) / 255 );
			return 0.2126 * r + 0.7152 * g + 0.0722 * b;

		};
		const tops = [];
		for ( let seed = 0; seed < 1000; seed ++ ) {

			const recipe = personRecipe( { gender: seed % 2 ? 'female' : 'male', appearanceSeed: seed * 2654435761 >>> 0 } );
			const { top, pants } = recipe.outfit.colors;
			tops.push( top.primary );
			expect( pants.primary ).not.toBe( top.primary );
			expect( Math.abs( lightness( top.secondary ) - lightness( top.primary ) ) ).toBeGreaterThan( 0.15 );

		}
		expect( new Set( tops ).size ).toBeGreaterThan( 15 );
		expect( tops.filter( ( color ) => lightness( color ) < 0.2 ).length / tops.length ).toBeLessThan( 0.4 );
		// The same seed dresses the same way.
		expect( personRecipe( { gender: 'male', appearanceSeed: 77 } ).outfit ).toEqual( personRecipe( { gender: 'male', appearanceSeed: 77 } ).outfit );

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
