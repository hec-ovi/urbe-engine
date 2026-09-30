import { describe, expect, it } from 'vitest';
import { colorName, describeLook } from './Describe.js';
import { defaultRecipe, personRecipe } from './Recipe.js';

describe( 'describeLook', () => {

	it( 'says what the recipe draws: height, build, face, hair, skin, eyes, each garment in its colours and the fabric', () => {

		const recipe = defaultRecipe( 'regular-male' );
		Object.assign( recipe.shape, { height: 1.05, shoulders: 1.08, jawWidth: 1.15, eyeSize: 0.88 } );
		recipe.hair = 'Hairstyles/Rigged to Head Bone/Male/Hair_Dreads.gltf';
		recipe.colors = { skin: '#4b3026', hair: '#191a20', eyes: '#738ea1' };
		recipe.outfit = { ...recipe.outfit, top: 'jacket-bomber', pants: 'pants-joggers', footwear: 'sneakers-high', fabric: 'leather' };
		recipe.outfit.colors.top = { primary: '#202c3b', secondary: '#91bfc2', accent: '#91bfc2' };
		expect( describeLook( recipe ) ).toEqual( {
			height: 'tall',
			build: 'an average build with broad shoulders',
			face: [ 'a strong, wide jaw', 'small eyes' ],
			hair: 'black hair in dreadlocks',
			skin: 'deep brown',
			eyes: 'blue-grey',
			wearing: [ 'a navy bomber jacket with light teal shoulders', `${colorName( recipe.outfit.colors.pants.primary )} joggers`, `${colorName( recipe.outfit.colors.footwear.primary )} high-top sneakers` ],
			fabric: 'leather'
		} );

	} );

	it( 'names every person the street draws in plain words, bald heads and open fronts included', () => {

		for ( let seed = 0; seed < 200; seed ++ ) {

			const look = describeLook( personRecipe( { gender: seed % 2 ? 'female' : 'male', appearanceSeed: seed * 7919 } ) );
			for ( const words of [ look.height, look.build, look.hair, look.skin, look.eyes, look.fabric, ...look.face, ...look.wearing ] ) {

				expect( words ).toMatch( /^[a-zA-Z][a-zA-Z ,:'-]+$/ );

			}
			expect( look.wearing ).toHaveLength( 3 );

		}
		const bald = defaultRecipe( 'regular-male' );
		bald.hair = '';
		expect( describeLook( bald ).hair ).toBe( 'none: a shaved head' );
		const suit = defaultRecipe( 'regular-female' );
		suit.outfit.top = 'office-jacket';
		suit.outfit.colors.top = { primary: '#35313d', secondary: '#b4a1bb', accent: '#b4a1bb' };
		expect( describeLook( suit ).wearing[ 0 ] ).toBe( 'a charcoal suit jacket open over a light mauve grey front' );

	} );

	it( 'names colours by family and lightness', () => {

		expect( [ '#202c3b', '#343a3b', '#bdb8aa', '#b99c72', '#91bfc2', '#665344', '#263c37', '#75525c', '#111111', '#f4f4f4' ].map( colorName ) )
			.toEqual( [ 'navy', 'charcoal', 'cream', 'sand', 'light teal', 'brown', 'dark teal', 'mauve', 'black', 'white' ] );

	} );

} );
