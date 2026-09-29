import { describe, expect, it, vi } from 'vitest';
import { TEMPLATES, TOP_PANELS, appearance, lookOf, recipeFor } from './Appearance.js';
import { packLook } from './CrowdLook.js';
import { AvatarTemplates } from './avatar/Templates.js';
import { HEIGHT_LIMITS, defaultRecipe, nearSkin, personRecipe } from './avatar/Recipe.js';
import { TOP_CUTS } from './avatar/Tops.js';
import { FOOTWEAR_CUTS, PANTS_CUTS } from './avatar/Lower.js';
import liaison from './avatar/templates/district-liaison.json' with { type: 'json' };

const hex = ( color ) => `#${color.getHexString()}`;

describe( 'a person\'s look', () => {

	it( 'is the recipe their gender and seed give, with the street\'s share of authored outfits, the same every time it is asked', () => {

		const person = { gender: 'female', appearanceSeed: 2754811393 };
		const look = appearance( person );
		expect( appearance( person ) ).toEqual( look );
		expect( look.recipe ).toEqual( personRecipe( person, { outfits: TEMPLATES.outfits } ) );
		expect( look.template ).toBeNull();
		// Their type plays no part: a body handed somebody of another type keeps its look.
		expect( appearance( { ...person, type: 'police_officer' } ) ).toEqual( look );

	} );

	it( 'paints the recipe\'s colours and cuts each garment where its pattern cuts it', () => {

		const recipe = personRecipe( { gender: 'male', appearanceSeed: 3141592653 } );
		const look = lookOf( recipe );
		const { top, pants, footwear, colors } = recipe.outfit;
		expect( [ look.skin, look.hair, look.eyes ].map( hex ) ).toEqual( [ recipe.colors.skin, recipe.colors.hair, recipe.colors.eyes ] );
		expect( [ look.shirt, look.panel, look.trousers, look.shoes ].map( hex ) ).toEqual( [ colors.top.primary, colors.top.secondary, colors.pants.primary, colors.footwear.primary ] );
		expect( look ).toMatchObject( {
			sleeve: TOP_CUTS[ top ].sleeve, topHem: TOP_CUTS[ top ].hem, pantsHem: PANTS_CUTS[ pants ].hem,
			waist: PANTS_CUTS[ pants ].waist, bootTop: FOOTWEAR_CUTS[ footwear ].top, height: recipe.shape.height, hairStyle: recipe.hair
		} );
		expect( lookOf( { ...recipe, outfit: { ...recipe.outfit, top: 'office-jacket' } } ) ).toMatchObject( { panelStyle: TOP_PANELS.open, tucked: false } );
		expect( lookOf( { ...recipe, outfit: { ...recipe.outfit, top: 'top-tee' } } ) ).toMatchObject( { panelStyle: TOP_PANELS.yoke, tucked: true } );
		expect( lookOf( { ...recipe, outfit: { ...recipe.outfit, pants: 'pants-shorts' } } ).pantsHem ).toBeGreaterThan( 0.3 );

	} );

	it( 'paints a slot worn bare as skin and cuts nothing there', () => {

		const recipe = defaultRecipe( 'regular-female' );
		const bare = lookOf( { ...recipe, outfit: { ...recipe.outfit, top: 'none', pants: 'none', footwear: 'none' } } );
		expect( [ bare.shirt, bare.trousers, bare.shoes ].map( hex ) ).toEqual( Array( 3 ).fill( recipe.colors.skin ) );
		expect( bare ).toMatchObject( { sleeve: 0, topHem: 1, neck: 0, pantsHem: 1, waist: 0, bootTop: 0, panelStyle: TOP_PANELS.plain } );

	} );

	it( 'draws an authored person as their template, by npcId and of their gender only', () => {

		const templates = new AvatarTemplates( { liaison: { name: 'Liaison', recipe: liaison.recipe, people: [ 'npc-7' ] } } );
		const own = recipeFor( { gender: 'female', appearanceSeed: 9, npcId: 'npc-7' }, templates );
		expect( own ).toEqual( { recipe: templates.named( 'Liaison' ).recipe, template: 'liaison' } );
		expect( appearance( { gender: 'female', appearanceSeed: 9, npcId: 'npc-7' }, templates ).template ).toBe( 'liaison' );
		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		const other = recipeFor( { gender: 'male', appearanceSeed: 9, npcId: 'npc-7' }, templates );
		expect( other.template ).toBeNull();
		expect( other.recipe.body ).toBe( 'regular-male' );
		expect( warn ).toHaveBeenCalledOnce();
		warn.mockRestore();

	} );

	it( 'packs a look into the crowd\'s spare lanes as whole numbers a float holds exactly', () => {

		for ( let seed = 0; seed < 200; seed ++ ) {

			const look = appearance( { gender: seed % 2 ? 'male' : 'female', appearanceSeed: seed * 2654435761 >>> 0 } );
			const pack = packLook( look );
			expect( packLook( look ) ).toBe( pack );
			for ( const lane of Object.values( pack ) ) {

				expect( Number.isInteger( lane ) ).toBe( true );
				expect( lane ).toBeLessThan( 2 ** 24 );
				expect( Math.fround( lane ) ).toBe( lane );

			}
			const byte = ( lane, index ) => Math.floor( lane / 256 ** index ) % 256;
			expect( byte( pack.cuts, 0 ) / 255 ).toBeCloseTo( look.sleeve, 2 );
			expect( byte( pack.cuts, 1 ) / 255 ).toBeCloseTo( look.topHem, 2 );
			expect( byte( pack.cuts, 2 ) / 255 ).toBeCloseTo( look.pantsHem, 2 );
			expect( byte( pack.figure, 0 ) / 255 ).toBeCloseTo( look.bootTop, 2 );
			expect( byte( pack.figure, 1 ) / 255 ).toBeCloseTo( look.neck, 2 );
			const flags = byte( pack.figure, 2 );
			expect( flags & 3 ).toBe( look.panelStyle );
			expect( Boolean( flags & 4 ) ).toBe( look.tucked );
			expect( HEIGHT_LIMITS[ 0 ] + ( flags >> 3 ) / 31 * ( HEIGHT_LIMITS[ 1 ] - HEIGHT_LIMITS[ 0 ] ) ).toBeCloseTo( look.height, 2 );
			expect( `#${pack.shoes.toString( 16 ).padStart( 6, '0' )}` ).toBe( hex( look.shoes ) );
			expect( `#${pack.panel.toString( 16 ).padStart( 6, '0' )}` ).toBe( hex( look.panel ) );
			expect( nearSkin( hex( look.shirt ), hex( look.skin ) ) ).toBe( false );

		}

	} );

} );
