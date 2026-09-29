import * as THREE from 'three/webgpu';
import { bodyOf, personRecipe } from './avatar/Recipe.js';
import { AvatarTemplates } from './avatar/Templates.js';
import { TOP_CUTS } from './avatar/Tops.js';
import { FOOTWEAR_CUTS, PANTS_CUTS } from './avatar/Lower.js';

/** The authored characters the game ships (avatar/templates). */
export const TEMPLATES = new AvatarTemplates();
/** Where each top ends at the neck, its collar's height as a share of body height. */
const COLLARS = {
	'tech-top': 0.864, 'police-jacket': 0.878, 'office-jacket': 0.86, 'top-tee': 0.853, 'top-tank': 0.85,
	'top-turtleneck': 0.887, 'jacket-cropped': 0.86, 'vest-tailored': 0.85, 'shirt-utility': 0.854, 'jacket-bomber': 0.86
};
/**
 * How the crowd paints a top's second colour, as the top's own panels mostly
 * show it: not at all, in an open front, across the shoulders, or across the
 * shoulders and down the upper sleeves.
 */
export const TOP_PANELS = { plain: 0, open: 1, yoke: 2, sleeved: 3 };
const PANEL_OF = {
	'office-jacket': 'open', 'vest-tailored': 'open', 'top-tank': 'plain',
	'tech-top': 'yoke', 'police-jacket': 'sleeved', 'top-tee': 'yoke', 'top-turtleneck': 'yoke',
	'jacket-cropped': 'yoke', 'jacket-bomber': 'yoke', 'shirt-utility': 'yoke'
};
/** The tops that go under the trousers' waistband (the patterns' `tucked`). */
const TUCKED = new Set( [ 'tech-top', 'top-tee', 'top-tank', 'top-turtleneck' ] );
const warned = new Set();

/**
 * The recipe a person is drawn in, decided by who they are and never again:
 * the authored person a template names by npcId, when that person's body is
 * of their gender, else the studio's generator on their appearance seed
 * (Recipe.personRecipe), with the templates' outfits in their shares of the
 * street. Their type plays no part: the crowd hands a body the handle of
 * somebody of another type now and then, and a look must not change under
 * the eyes of whoever watches it.
 *
 * @returns `{ recipe, template }`, the template's id or null
 */
export function recipeFor( { gender, appearanceSeed, npcId = null }, templates = TEMPLATES ) {

	const template = templates.forPerson( npcId );
	if ( template && bodyOf( template.recipe ).gender === gender ) return { recipe: template.recipe, template: template.id };
	if ( template && ! warned.has( npcId ) ) {

		warned.add( npcId );
		console.warn( `${template.name} is a ${bodyOf( template.recipe ).gender} body and ${npcId} is ${gender}: drawn from their seed instead` );

	}
	return { recipe: personRecipe( { gender, appearanceSeed: appearanceSeed >>> 0 }, { outfits: templates.outfits } ), template: null };

}

/**
 * One person's look, decided once from who they are: their recipe, and what
 * the crowd paints of it on its baked bodies. The colours are linear; the
 * cuts are where each garment ends, as shares of the body's height the way
 * its pattern cuts it, so a crowd body and the focused body with the
 * garments sewn on cover the same skin.
 *
 * - `skin`, `hair`, `eyes`: the recipe's colours
 * - `shirt`, `panel`: the top's main and second colour, `trousers`, `shoes`
 *   the main colours of the rest; a slot worn bare takes the skin's
 * - `sleeve`: how far out along the outstretched arm the top reaches
 * - `topHem`, `neck`, `tucked`, `panelStyle`: where the top ends below and
 *   above, whether it goes under the trousers, how its second colour shows (TOP_PANELS)
 * - `pantsHem`, `waist`, `bootTop`: where the trousers and footwear end
 * - `height`: the recipe's height, a share of its frame's
 * - `hairStyle`: the recipe's hairstyle, '' for none
 */
export function appearance( person, templates = TEMPLATES ) {

	const { recipe, template } = recipeFor( person, templates );
	return lookOf( recipe, template );

}

/** What the crowd paints of a recipe (see `appearance`). */
export function lookOf( recipe, template = null ) {

	const { outfit, colors } = recipe;
	const skin = color( colors.skin );
	const worn = ( slot ) => outfit[ slot ] && outfit[ slot ] !== 'none';
	const top = worn( 'top' ) ? outfit.top : null;
	const pants = worn( 'pants' ) ? outfit.pants : null;
	const footwear = worn( 'footwear' ) ? outfit.footwear : null;
	const shirt = top ? color( outfit.colors.top.primary ) : skin.clone();
	return {
		recipe,
		template,
		skin,
		hair: color( colors.hair ),
		eyes: color( colors.eyes ),
		shirt,
		panel: top ? color( outfit.colors.top.secondary ) : shirt.clone(),
		trousers: pants ? color( outfit.colors.pants.primary ) : skin.clone(),
		shoes: footwear ? color( outfit.colors.footwear.primary ) : skin.clone(),
		sleeve: top ? TOP_CUTS[ top ].sleeve : 0,
		topHem: top ? TOP_CUTS[ top ].hem : 1,
		neck: top ? COLLARS[ top ] : 0,
		tucked: Boolean( top && TUCKED.has( top ) ),
		panelStyle: TOP_PANELS[ top ? PANEL_OF[ top ] : 'plain' ],
		pantsHem: pants ? PANTS_CUTS[ pants ].hem : 1,
		waist: pants ? PANTS_CUTS[ pants ].waist : 0,
		bootTop: footwear ? FOOTWEAR_CUTS[ footwear ].top : 0,
		height: recipe.shape.height,
		hairStyle: recipe.hair
	};

}

function color( hex ) {

	return new THREE.Color( hex );

}
