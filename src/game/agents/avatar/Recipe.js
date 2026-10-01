/*
 * Character recipes, carried over from the NPC Studio (codex_npcs, src/recipe.js,
 * src/catalog.js, src/persona.js, src/face.js, src/height.js limits): the
 * studio's `codex-npcs-persona` v1 format, its validation and its seeded
 * generator, so a recipe exported from the studio is a person here and a seed
 * gives the same person in both.
 */
import { CHARACTER_MODELS, HAIRSTYLES } from '../CharacterCatalog.js';

export const RECIPE_FORMAT = 'codex-npcs-persona';
export const RECIPE_VERSION = 1;

/** Slot order of an outfit, and the garments each slot takes. */
export const SLOTS = [ 'top', 'pants', 'footwear' ];
export const GARMENTS = {
	top: [
		'tech-top', 'police-jacket', 'office-jacket', 'top-tee', 'top-tank',
		'top-turtleneck', 'jacket-cropped', 'vest-tailored', 'shirt-utility', 'jacket-bomber'
	],
	pants: [
		'pants-tech', 'pants-patrol', 'pants-office', 'pants-leggings',
		'pants-chinos', 'pants-cargo', 'pants-shorts', 'pants-joggers'
	],
	footwear: [ 'boots-patrol', 'shoes-city', 'sneakers-low', 'sneakers-high', 'boots-chelsea', 'boots-tall' ]
};
export const FABRICS = [ 'tech', 'woven', 'leather' ];
export const COLOR_CHANNELS = [ 'primary', 'secondary', 'accent' ];

const BODY_DEFAULTS = {
	height: 1, build: 1, thickness: 1, shoulders: 1, chest: 1, waist: 1,
	hips: 1, glutes: 1, arms: 1, legs: 1, thighs: 1
};
const FACE_DEFAULTS = { faceWidth: 1, jawWidth: 1, noseSize: 1, mouthWidth: 1, eyeSize: 1, eyeSpacing: 1 };

/** Every shape control at its neutral value, in the studio's order: the generator reads them in it. */
export const DEFAULT_SHAPE = Object.freeze( { ...BODY_DEFAULTS, ...FACE_DEFAULTS } );
export const BODY_SHAPE_KEYS = Object.freeze( Object.keys( BODY_DEFAULTS ) );
export const FACE_SHAPE_KEYS = Object.freeze( Object.keys( FACE_DEFAULTS ) );
/** Anatomical height, a share of the frame's own: legs and torso lengthen, head, hands and feet do not. */
export const HEIGHT_LIMITS = Object.freeze( [ 0.94, 1.06 ] );
export const SHAPE_LIMITS = Object.freeze( {
	...Object.fromEntries( BODY_SHAPE_KEYS.map( ( key ) => [ key, Object.freeze(
		key === 'height' ? HEIGHT_LIMITS : key === 'glutes' ? [ 0.6, 1.8 ] : key === 'thickness' || key === 'thighs' ? [ 0.8, 1.4 ] : [ 0.8, 1.2 ]
	) ] ) ),
	faceWidth: Object.freeze( [ 0.8, 1.2 ] ),
	jawWidth: Object.freeze( [ 0.8, 1.2 ] ),
	noseSize: Object.freeze( [ 0.8, 1.2 ] ),
	mouthWidth: Object.freeze( [ 0.8, 1.2 ] ),
	eyeSize: Object.freeze( [ 0.85, 1.15 ] ),
	eyeSpacing: Object.freeze( [ 0.9, 1.1 ] )
} );

/** The shape keys version 1 always had; a later control missing from a recipe reads as neutral. */
const ORIGINAL_SHAPE_KEYS = new Set( [ 'height', 'build', 'shoulders', 'chest', 'waist', 'hips', 'arms', 'legs' ] );
const SCOPES = new Set( [ 'all', 'shape', 'clothing', 'appearance' ] );
/** The supplied Superhero female export holds only an upper body, so no recipe wears it. */
const WHOLE_BODIES = CHARACTER_MODELS.filter( ( model ) => model.id !== 'superhero-female' );
const FACIAL_HAIR = /Hair_(Beard|Moustache|MuttonChops)/;

const SKIN_COLORS = [ '#edc6ac', '#d8ad8d', '#bd8b68', '#a77550', '#895735', '#66452f', '#4b3026' ];
const HAIR_COLORS = [ '#191a20', '#272321', '#4b3125', '#7f5639', '#b68d54', '#d2c0a0', '#867d79', '#473e55' ];
const EYE_COLORS = [ '#453c30', '#684a2e', '#81907a', '#65756a', '#738ea1', '#727580', '#afa17e' ];
// Authored separates keep trousers and footwear from being progressively
// darker copies of a shirt. Each slot still exposes the same three channels.
const OUTFIT_PALETTES = [
	{ // Work blue, pale collar and stone trousers.
		top: [ '#3d6787', '#c4c8ba', '#b79b67' ], pants: [ '#b5ad92', '#827c6a', '#d3c9aa' ], footwear: [ '#3b4146', '#72766f', '#bdb49a' ]
	},
	{ // Chalk separates with ink-blue trousers.
		top: [ '#d2cdbd', '#435563', '#a86646' ], pants: [ '#2c3b49', '#687683', '#bdb49a' ], footwear: [ '#625143', '#99836b', '#c2af89' ]
	},
	{ // Brick with washed black; colour lives in the cloth, not luminous trim.
		top: [ '#9b4c42', '#3b3035', '#d0b9a0' ], pants: [ '#34383d', '#6c706f', '#b09874' ], footwear: [ '#3a3430', '#716457', '#baa78b' ]
	},
	{
		top: [ '#74816a', '#394a40', '#c9c0a2' ], pants: [ '#393f47', '#727a7c', '#b0b4a6' ], footwear: [ '#67594a', '#918477', '#c2b596' ]
	},
	{
		top: [ '#586b79', '#bdc4c3', '#b78655' ], pants: [ '#a3987b', '#69634f', '#cbc2a7' ], footwear: [ '#454346', '#797676', '#b7b2a7' ]
	},
	{
		top: [ '#72546b', '#b2a6ae', '#c6b88e' ], pants: [ '#aaaba8', '#717780', '#d0cabe' ], footwear: [ '#483d46', '#7a6d77', '#b7aca3' ]
	},
	{
		top: [ '#b19448', '#514b36', '#d1c49c' ], pants: [ '#4d5c4e', '#83927e', '#bfb69b' ], footwear: [ '#625444', '#95836b', '#c8b899' ]
	},
	{ // Washed denim panels with a darker indigo lower half.
		top: [ '#7396ac', '#c8c3ad', '#465864' ], pants: [ '#354d68', '#708597', '#b7a486' ], footwear: [ '#4f514d', '#84867c', '#c7c1ad' ]
	},
	{
		top: [ '#3f7d79', '#b0bfaf', '#c49a59' ], pants: [ '#937754', '#5e5244', '#c4b08b' ], footwear: [ '#443d36', '#7d6f60', '#bda887' ]
	},
	{ // A dark top can contrast through its trousers and trim.
		top: [ '#323a42', '#b6bdbb', '#a78959' ], pants: [ '#90977c', '#5c6656', '#cac7b0' ], footwear: [ '#5b5149', '#8e8173', '#bcb3a1' ]
	},
	{
		top: [ '#ac6750', '#e0cdb0', '#494742' ], pants: [ '#36455c', '#718192', '#b7ab97' ], footwear: [ '#4b3d35', '#876e58', '#bba37e' ]
	},
	{
		top: [ '#69758c', '#c0c2c5', '#b89d78' ], pants: [ '#c7beaa', '#8e877a', '#585d66' ], footwear: [ '#797266', '#aaa293', '#d2c7ae' ]
	},
	{ // Deliberate dark-on-dark remains one choice, with distinct panels.
		top: [ '#292b30', '#646a70', '#b3b9b6' ], pants: [ '#393b40', '#737676', '#b6aea0' ], footwear: [ '#303438', '#676c70', '#a6aaa4' ]
	},
	{
		top: [ '#9c4148', '#302d36', '#d8c5a6' ], pants: [ '#6e7279', '#444c58', '#b6b7b3' ], footwear: [ '#4b4145', '#87777c', '#c5b6a7' ]
	}
];
// Canvas uppers and rubber soles carry their own colours; boots and city
// shoes instead retain the leather colours authored above.
const SNEAKER_PALETTES = [
	[ '#bdb9a9', '#43586a', '#d6ccb3' ],
	[ '#6c8492', '#d0cbbb', '#bc8454' ],
	[ '#974e47', '#c8c1ae', '#443b3e' ],
	[ '#858c74', '#c6c3ad', '#49534b' ],
	[ '#484f58', '#c2c4bc', '#aeb9bd' ],
	[ '#c2b7a2', '#7d6376', '#dad0b9' ]
];
// Patrol pieces stay recognisably uniform even when a separate is mixed in.
const PATROL_PALETTES = [
	{ top: [ '#354c64', '#879ca8', '#c5bb91' ], pants: [ '#344558', '#697d8a', '#b4b6a5' ] },
	{ top: [ '#64747b', '#d0cdb8', '#b8a368' ], pants: [ '#414e58', '#869297', '#b3b5a8' ] },
	{ top: [ '#47594f', '#9da896', '#c8b77e' ], pants: [ '#384a42', '#728477', '#bdb59b' ] },
	{ top: [ '#a4a898', '#405464', '#c9bb85' ], pants: [ '#3e5060', '#7c8a8f', '#bbb8a4' ] }
];
const OUTFIT_SETS = [
	{ top: 'tech-top', pants: 'pants-tech', footwear: 'boots-patrol', fabrics: [ 'tech' ] },
	{ top: 'police-jacket', pants: 'pants-patrol', footwear: 'boots-patrol', fabrics: [ 'tech', 'woven' ] },
	{ top: 'office-jacket', pants: 'pants-office', footwear: 'shoes-city', fabrics: [ 'woven', 'woven', 'tech' ] },
	{ top: 'top-tee', pants: 'pants-chinos', footwear: 'sneakers-low', fabrics: [ 'woven', 'tech' ] },
	{ top: 'top-tank', pants: 'pants-cargo', footwear: 'sneakers-high', fabrics: [ 'tech', 'woven' ] },
	{ top: 'top-turtleneck', pants: 'pants-office', footwear: 'boots-chelsea', fabrics: [ 'woven', 'tech' ] },
	{ top: 'jacket-cropped', pants: 'pants-leggings', footwear: 'boots-tall', fabrics: [ 'leather', 'tech' ] },
	{ top: 'vest-tailored', pants: 'pants-office', footwear: 'shoes-city', fabrics: [ 'woven' ] },
	{ top: 'shirt-utility', pants: 'pants-shorts', footwear: 'sneakers-low', fabrics: [ 'woven', 'tech' ] },
	{ top: 'jacket-bomber', pants: 'pants-joggers', footwear: 'sneakers-high', fabrics: [ 'tech', 'leather' ] }
];
const DEFAULT_OUTFIT = {
	top: 'tech-top', pants: 'pants-tech', footwear: 'boots-patrol', fabric: 'tech',
	colors: {
		top: { primary: '#202c3b', secondary: '#536377', accent: '#4de1dc' },
		pants: { primary: '#202937', secondary: '#465768', accent: '#4de1dc' },
		footwear: { primary: '#151c25', secondary: '#374553', accent: '#4de1dc' }
	}
};
/**
 * How near a top's main colour may come to the wearer's skin before the
 * street's wardrobe leaves it out for them: a street drawn from far away
 * reads a skin-coloured shirt as a bare chest.
 */
const SKIN_CLEARANCE = 0.16;

/** The whole bodies a recipe may wear, with the hairstyles each takes. */
export const RECIPE_BODIES = WHOLE_BODIES.map( ( model ) => model.id );

/** The hairstyles a body takes: its adult or teen set, facial hair among them, or none (''). */
export function hairstylesFor( bodyId ) {

	const model = WHOLE_BODIES.find( ( entry ) => entry.id === bodyId );
	if ( ! model ) throw new TypeError( `Unsupported body: ${String( bodyId )}.` );
	const set = HAIRSTYLES[ model.gender ];
	const teen = model.id.startsWith( 'teen-' );
	return [ '', ...( teen ? set.teen : set.adult ), ...( teen ? set.teenFacial : set.facial ) ];

}

/** The catalog entry a recipe's body names. */
export function bodyOf( recipe ) {

	const model = WHOLE_BODIES.find( ( entry ) => entry.id === recipe.body );
	if ( ! model ) throw new TypeError( `Unsupported body: ${String( recipe.body )}.` );
	return model;

}

/** A fresh neutral recipe on a body, in its default hairstyle and the studio's default outfit. */
export function defaultRecipe( bodyId = 'regular-male' ) {

	const model = WHOLE_BODIES.find( ( entry ) => entry.id === bodyId );
	if ( ! model ) throw new TypeError( `Unsupported body: ${String( bodyId )}.` );
	return {
		format: RECIPE_FORMAT,
		version: RECIPE_VERSION,
		body: model.id,
		hair: model.hair,
		shape: { ...DEFAULT_SHAPE },
		colors: { skin: '#bd8b68', hair: '#272321', eyes: '#65756a' },
		outfit: structuredClone( DEFAULT_OUTFIT ),
		animation: 'Idle_Loop'
	};

}

/**
 * External data as a new canonical recipe, or a TypeError naming what is
 * wrong. Finite shape values clamp to the authored limits, and a control
 * added after a recipe was written reads as neutral. Unknown fields are
 * dropped and the result shares nothing with the input.
 */
export function normalizeRecipe( input ) {

	requireRecord( input, 'recipe' );
	if ( input.format !== RECIPE_FORMAT || input.version !== RECIPE_VERSION ) {

		throw new TypeError( 'Unsupported character recipe format or version.' );

	}
	const body = WHOLE_BODIES.find( ( entry ) => entry.id === input.body );
	if ( ! body ) throw new TypeError( `Unsupported body: ${String( input.body )}.` );
	if ( ! hairstylesFor( body.id ).includes( input.hair ) ) throw new TypeError( `Unsupported hairstyle for ${body.id}.` );
	requireRecord( input.shape, 'shape' );
	const shape = {};
	for ( const [ key, neutral ] of Object.entries( DEFAULT_SHAPE ) ) {

		const value = input.shape[ key ] === undefined && ! ORIGINAL_SHAPE_KEYS.has( key ) ? neutral : input.shape[ key ];
		if ( ! Number.isFinite( value ) ) throw new TypeError( `Invalid shape.${key}: expected a finite number.` );
		const [ min, max ] = SHAPE_LIMITS[ key ];
		shape[ key ] = Math.max( min, Math.min( max, value ) );

	}
	requireRecord( input.colors, 'colors' );
	const colors = Object.fromEntries( [ 'skin', 'hair', 'eyes' ].map( ( key ) => [ key, normalizeColor( input.colors[ key ], `colors.${key}` ) ] ) );
	requireRecord( input.outfit, 'outfit' );
	if ( ! FABRICS.includes( input.outfit.fabric ) ) throw new TypeError( `Unsupported outfit.fabric: ${String( input.outfit.fabric )}.` );
	requireRecord( input.outfit.colors, 'outfit.colors' );
	const outfit = { top: '', pants: '', footwear: '', fabric: input.outfit.fabric, colors: {} };
	for ( const slot of SLOTS ) {

		const id = input.outfit[ slot ];
		if ( id !== 'none' && ! GARMENTS[ slot ].includes( id ) ) throw new TypeError( `Unsupported outfit.${slot}: ${String( id )}.` );
		outfit[ slot ] = id;
		requireRecord( input.outfit.colors[ slot ], `outfit.colors.${slot}` );
		outfit.colors[ slot ] = Object.fromEntries( COLOR_CHANNELS.map( ( channel ) => [
			channel, normalizeColor( input.outfit.colors[ slot ][ channel ], `outfit.colors.${slot}.${channel}` )
		] ) );

	}
	if ( typeof input.animation !== 'string' || ! input.animation.trim() || input.animation.length > 160 ) {

		throw new TypeError( 'Invalid animation: expected a nonempty clip name.' );

	}
	return { format: RECIPE_FORMAT, version: RECIPE_VERSION, body: body.id, hair: input.hair, shape, colors, outfit, animation: input.animation };

}

/**
 * The studio's generator: the same recipe, seed and scope give the same
 * recipe in the studio, in Node and here. `all` picks a regular male or
 * female body; the other scopes keep the body. The animation never changes.
 *
 * @param seed a string or a finite number; `12` and `'12'` are different seeds
 */
export function randomizeRecipe( base = defaultRecipe(), { seed, scope = 'all' } = {} ) {

	if ( ! SCOPES.has( scope ) ) throw new TypeError( `Unknown randomization scope: ${String( scope )}.` );
	const recipe = normalizeRecipe( base );
	const random = seededRandom( seed );
	const pick = ( list ) => list[ Math.floor( random() * list.length ) ];
	if ( scope === 'all' ) recipe.body = pick( [ 'regular-male', 'regular-female' ] );
	generate( recipe, random, pick, scope );
	return recipe;

}

/**
 * The recipe a person of the crowd is drawn with: the studio's generator on
 * their appearance seed, on the regular body of their gender. The seed is read
 * exactly as the studio's `all` scope reads it, so the person's hairstyle,
 * colouring, face, height and garments are the studio's for that numeric seed
 * wherever the studio picked their gender. Their build is read off the
 * studio's draw into an ordinary street range (`streetBuild`), their clothes
 * are coloured from the street's wardrobe (`streetColors`), never a top near
 * their skin, and each of `outfits` dresses its share of the crowd instead.
 *
 * @param outfits `{ outfit, share }`: an authored outfit (`{ top, pants,
 *   footwear, fabric, colors }`) and the share of people who wear it
 */
export function personRecipe( { gender, appearanceSeed }, { outfits = [] } = {} ) {

	const recipe = defaultRecipe( gender === 'female' ? 'regular-female' : 'regular-male' );
	const random = seededRandom( appearanceSeed >>> 0 );
	const pick = ( list ) => list[ Math.floor( random() * list.length ) ];
	// The studio's body pick: drawn so the rest of the stream stays the studio's.
	random();
	generate( recipe, random, pick, 'all' );
	streetBuild( recipe.shape );
	const authored = sharedOutfit( outfits, random() );
	if ( authored ) recipe.outfit = structuredClone( authored );
	else recipe.outfit.colors = streetColors( recipe.colors.skin, appearanceSeed >>> 0 );
	return recipe;

}

/**
 * Where a person's three builds lie on the street, as amounts off neutral:
 * the upper body (build, thickness, chest and arms, the shoulders at
 * SHOULDER_SHARE of it), the waist, and the lower body (hips, seat and
 * thighs). The pack's bodies stand athletic to heavy at neutral, the
 * female's hips and thighs the fullest, so the street centres on an
 * ordinary build below them: slim to broad shoulders, never a fuller waist,
 * hips or thighs than the pack's own.
 */
export const STREET_BUILDS = Object.freeze( {
	upper: Object.freeze( { spread: 0.18, centre: - 0.06, range: Object.freeze( [ - 0.15, 0.04 ] ) } ),
	waist: Object.freeze( { spread: 0.1, centre: - 0.07, range: Object.freeze( [ - 0.15, - 0.01 ] ) } ),
	lower: Object.freeze( { spread: 0.15, centre: - 0.06, range: Object.freeze( [ - 0.14, 0.01 ] ) } )
} );
/** The controls each build moves together, as the crowd's baked bodies take them (CharacterAssets, BodyShape). */
export const BUILD_KEYS = Object.freeze( {
	upper: Object.freeze( [ 'build', 'thickness', 'chest', 'arms' ] ),
	waist: Object.freeze( [ 'waist' ] ),
	lower: Object.freeze( [ 'hips', 'glutes', 'thighs' ] )
} );
const SHOULDER_SHARE = 0.6;
/** The legs keep this share of the studio's spread. */
const LEG_SPREAD = 0.4;
/** Height spreads this much wider than the studio draws it, within its limits: short to tall shows across a street. */
const HEIGHT_SPREAD = 1.6;
/** The studio's seat is centred on 1.28 by its +0.35 lift over a 0.8 upper span. */
const STUDIO_SEAT_CENTRE = 1.28;

/**
 * A person's build on the street, read off the studio's draw. The studio
 * draws across its whole editing range and favours a fuller seat, which
 * crowds a street with exaggerated figures; squeezed toward neutral instead,
 * everybody stands in one build. So each of the three builds (STREET_BUILDS)
 * takes the mean of the studio's draw over its controls, as a share of each
 * control's span, and places it in its street range: the controls of a build
 * then move together, which is also how the crowd's baked bodies take a
 * person's shape. Height spreads HEIGHT_SPREAD times the studio's, within its
 * limits; the face keeps the studio's spread.
 */
export function streetBuild( shape ) {

	for ( const [ build, keys ] of Object.entries( BUILD_KEYS ) ) {

		const drawn = keys.reduce( ( sum, key ) => {

			const [ min, max ] = SHAPE_LIMITS[ key ];
			const centre = key === 'glutes' ? STUDIO_SEAT_CENTRE : 1;
			const offset = shape[ key ] - centre;
			return sum + offset / ( offset < 0 ? centre - min : max - centre );

		}, 0 ) / keys.length;
		const { spread, centre, range } = STREET_BUILDS[ build ];
		const amount = round( Math.max( range[ 0 ], Math.min( range[ 1 ], centre + drawn * spread ) ) );
		for ( const key of keys ) shape[ key ] = round( 1 + amount );
		if ( build === 'upper' ) shape.shoulders = round( 1 + amount * SHOULDER_SHARE );

	}
	shape.legs = round( 1 + ( shape.legs - 1 ) * LEG_SPREAD );
	shape.height = round( Math.max( HEIGHT_LIMITS[ 0 ], Math.min( HEIGHT_LIMITS[ 1 ], 1 + ( shape.height - 1 ) * HEIGHT_SPREAD ) ) );

}

/**
 * How a person's body differs from their frame's, as the three builds the
 * crowd draws (STREET_BUILDS): each the mean amount off neutral of its controls.
 */
export function buildsOf( shape ) {

	return Object.fromEntries( Object.entries( BUILD_KEYS ).map( ( [ build, keys ] ) => [
		build, keys.reduce( ( sum, key ) => sum + ( ( shape?.[ key ] ?? 1 ) - 1 ), 0 ) / keys.length
	] ) );

}

/**
 * The colours of the street's clothes: tops from the city's dark blues and
 * charcoals through slate, olive, rust, teal and burgundy to stone, sand and
 * off-white; trousers in denim, black, charcoal, grey, khaki, olive and
 * brown; shoes black, brown, tan, grey or white. The studio's palettes are
 * near-black almost all of them, so a crowd seen from across the street wore
 * one dark suit; a top and trousers here are drawn apart.
 */
const STREET_TOPS = [
	'#202c3b', '#2b2b2e', '#343a3b', '#3a2f38', '#4f5d6b', '#5a6b4a', '#6b4b3a', '#3f5f7a', '#6d3036',
	'#3e6461', '#7a5c2e', '#5b4a6e', '#b9b2a2', '#d9d4c8', '#8f979e', '#b08d57', '#a24a3f', '#c9a23e', '#6f8fa8'
];
const STREET_UNDERS = [ '#d9d4c8', '#1d1f24', '#8f979e', '#b9b2a2', '#3a3d42', '#efece4' ];
const STREET_ACCENTS = [ '#91bfc2', '#b9aa84', '#b4a1bb', '#a6bac3', '#abbb97', '#d4c1a0', '#c97b5c' ];
const STREET_TROUSERS = [ '#1d1f24', '#2c3e5a', '#41597a', '#3a3d42', '#5f6266', '#7d6f52', '#4f5238', '#4a3a2c', '#a39a86' ];
const STREET_SHOES = [ '#161618', '#2d2622', '#4a3324', '#8b6a45', '#d6d2c8', '#5e6064' ];

/**
 * A person's clothes coloured from the street's wardrobe, drawn from their
 * seed on a stream of its own, so the studio's draw of everything else stays
 * as it was: a top no nearer their skin than the generator allows, a second
 * colour that shows against it, trousers that are not the top's colour, and
 * shoes.
 */
export function streetColors( skin, seed ) {

	const random = seededRandom( `street:${seed}` );
	const pick = ( list ) => list[ Math.floor( random() * list.length ) ];
	const tops = STREET_TOPS.filter( ( color ) => ! nearSkin( color, skin ) );
	const top = pick( tops );
	const under = pick( STREET_UNDERS.filter( ( color ) => Math.abs( luma( color ) - luma( top ) ) > 0.2 ) );
	const trousers = pick( STREET_TROUSERS.filter( ( color ) => contrast( color, top ) > 0.08 ) );
	const shoes = pick( STREET_SHOES );
	const accent = pick( STREET_ACCENTS );
	return {
		top: { primary: top, secondary: under, accent },
		pants: { primary: trousers, secondary: shade( trousers, 0.8 ), accent },
		footwear: { primary: shoes, secondary: shade( shoes, 0.7 ), accent }
	};

}

/** One string per distinct recipe, for caches keyed by who is built. */
export function recipeKey( recipe ) {

	const { body, hair, shape, colors, outfit } = recipe;
	return JSON.stringify( [ body, hair, Object.keys( DEFAULT_SHAPE ).map( ( key ) => shape[ key ] ), colors, outfit ] );

}

/** Whether a colour is within the generator's reach of a skin tone. */
export function nearSkin( color, skin ) {

	const a = lab( color );
	const b = lab( skin );
	return Math.hypot( a[ 0 ] - b[ 0 ], ( a[ 1 ] - b[ 1 ] ) * 1.4, ( a[ 2 ] - b[ 2 ] ) * 1.4 ) < SKIN_CLEARANCE;

}

function generate( recipe, random, pick, scope ) {

	let palette = null;
	if ( scope === 'all' || scope === 'shape' ) {

		// Correlated proportions keep random people coherent while their own
		// variation keeps the crowd diverse inside every authored range.
		const build = centered( random );
		const lowerBody = centered( random );
		for ( const key of Object.keys( recipe.shape ) ) {

			let amount;
			if ( FACE_SHAPE_KEYS.includes( key ) ) amount = centered( random ) * 0.7;
			else if ( key === 'height' ) amount = centered( random ) * 0.85;
			else if ( [ 'hips', 'glutes', 'thighs' ].includes( key ) ) amount = lowerBody * 0.7 + centered( random ) * 0.3;
			else amount = build * 0.6 + centered( random ) * 0.4;
			// The supplied seat starts small, so the fuller half of its range comes up more often.
			if ( key === 'glutes' ) amount = Math.max( - 0.35, Math.min( 0.95, amount + 0.35 ) );
			const [ min, max ] = SHAPE_LIMITS[ key ];
			const span = amount < 0 ? 1 - min : max - 1;
			recipe.shape[ key ] = round( Math.max( min, Math.min( max, 1 + amount * span ) ) );

		}

	}
	if ( scope === 'all' || scope === 'appearance' ) {

		// None stays among the choices, as in the studio: some people are bald.
		recipe.hair = pick( hairstylesFor( recipe.body ).filter( ( hair ) => ! FACIAL_HAIR.test( hair ) ) );
		recipe.colors = { skin: pick( SKIN_COLORS ), hair: pick( HAIR_COLORS ), eyes: pick( EYE_COLORS ) };

	}
	if ( scope === 'all' || scope === 'clothing' ) {

		const coordinated = pick( OUTFIT_SETS );
		for ( const slot of SLOTS ) recipe.outfit[ slot ] = random() < 0.8 ? coordinated[ slot ] : pick( GARMENTS[ slot ] );
		const topStyle = OUTFIT_SETS.find( ( { top } ) => top === recipe.outfit.top ) ?? coordinated;
		recipe.outfit.fabric = pick( topStyle.fabrics );
		palette = pick( OUTFIT_PALETTES );
		recipe.outfit.colors = paletteColors( palette, recipe.outfit );

	}
	return palette;

}

/** The authored outfit a draw lands on when the shares are laid end to end from 0, or null past them. */
function sharedOutfit( outfits, draw ) {

	let edge = 0;
	for ( const { outfit, share } of outfits ) {

		edge += share;
		if ( draw < edge ) return outfit;

	}
	return null;

}

function paletteColors( palette, outfit ) {

	// Reuse the palette draw for family choices: body, shape, garment selection
	// and authored-outfit shares keep their existing seeded random sequence.
	const index = OUTFIT_PALETTES.indexOf( palette );
	const patrol = PATROL_PALETTES[ index % PATROL_PALETTES.length ];
	const colors = ( [ primary, secondary, accent ] ) => ( { primary, secondary, accent } );

	return {
		top: colors( outfit.top === 'police-jacket' ? patrol.top : palette.top ),
		pants: colors( outfit.pants === 'pants-patrol' ? patrol.pants : palette.pants ),
		footwear: colors( outfit.footwear.startsWith( 'sneakers-' ) ? SNEAKER_PALETTES[ index % SNEAKER_PALETTES.length ] : palette.footwear )
	};

}

function requireRecord( value, name ) {

	if ( ! value || typeof value !== 'object' || Array.isArray( value ) ) throw new TypeError( `Invalid ${name}: expected an object.` );

}

function normalizeColor( value, path ) {

	if ( typeof value !== 'string' || ! /^#[\da-f]{6}$/i.test( value ) ) throw new TypeError( `Invalid ${path}: expected a #rrggbb color.` );
	return value.toLowerCase();

}

function round( value ) {

	return Math.round( value * 1000 ) / 1000;

}

function centered( random ) {

	return random() + random() - 1;

}

function shade( color, factor ) {

	const channels = color.slice( 1 ).match( /../g ).map( ( channel ) => Math.round( parseInt( channel, 16 ) * factor ) );
	return `#${channels.map( ( channel ) => channel.toString( 16 ).padStart( 2, '0' ) ).join( '' )}`;

}

/** How far apart two colours sit in the rough perceptual space. */
function contrast( a, b ) {

	const [ l, x, y ] = lab( a );
	const [ m, u, v ] = lab( b );
	return Math.hypot( l - m, x - u, y - v );

}

function luma( color ) {

	return lab( color )[ 0 ];

}

/** A rough perceptual position: lightness and two opponent axes, all 0 to about 1. */
function lab( color ) {

	const [ r, g, b ] = color.slice( 1 ).match( /../g ).map( ( channel ) => parseInt( channel, 16 ) / 255 );
	return [ 0.2126 * r + 0.7152 * g + 0.0722 * b, r - g, ( r + g ) / 2 - b ];

}

/**
 * FNV-1a over the seed's type and value, then Mulberry32. Everything is
 * local arithmetic, so Node, the studio and the game draw the same numbers.
 */
function seededRandom( seed ) {

	if ( typeof seed !== 'string' && ( typeof seed !== 'number' || ! Number.isFinite( seed ) ) ) {

		throw new TypeError( 'Randomization seed must be a string or finite number.' );

	}
	const value = `${typeof seed}:${seed}`;
	let state = 2166136261;
	for ( let index = 0; index < value.length; index ++ ) state = Math.imul( state ^ value.charCodeAt( index ), 16777619 );
	return () => {

		state = ( state + 0x6d2b79f5 ) | 0;
		let mixed = Math.imul( state ^ ( state >>> 15 ), 1 | state );
		mixed ^= mixed + Math.imul( mixed ^ ( mixed >>> 7 ), 61 | mixed );
		return ( ( mixed ^ ( mixed >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}
