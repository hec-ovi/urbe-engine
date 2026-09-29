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
// One restrained palette dresses the whole outfit; each garment keeps three
// channels of its own after generation.
const OUTFIT_PALETTES = [
	[ '#202c3b', '#536377', '#91bfc2' ],
	[ '#343a3b', '#647572', '#b9aa84' ],
	[ '#35313d', '#746b7e', '#b4a1bb' ],
	[ '#3f3d39', '#bdb8aa', '#b99c72' ],
	[ '#293a46', '#617987', '#a6bac3' ],
	[ '#402d34', '#75525c', '#b999a3' ],
	[ '#263c37', '#657b70', '#abbb97' ],
	[ '#b8b2a4', '#4d5562', '#d4c1a0' ],
	[ '#29323c', '#dad6cc', '#a5aebc' ],
	[ '#665344', '#b6a38b', '#aec1b5' ]
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
 * generator dresses them in another palette: a street drawn from far away
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
 * exactly as the studio's `all` scope reads it, so the person is the studio's
 * for that numeric seed wherever the studio picked their gender. A top whose
 * main colour sits within reach of their skin is exchanged for the next
 * palette's, and each of `outfits` dresses its share of the crowd instead.
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
	const palette = generate( recipe, random, pick, 'all' );
	const authored = sharedOutfit( outfits, random() );
	if ( authored ) recipe.outfit = structuredClone( authored );
	else if ( nearSkin( recipe.outfit.colors.top.primary, recipe.colors.skin ) ) {

		const index = OUTFIT_PALETTES.indexOf( palette );
		for ( let step = 1; step < OUTFIT_PALETTES.length; step ++ ) {

			const next = OUTFIT_PALETTES[ ( index + step ) % OUTFIT_PALETTES.length ];
			if ( nearSkin( next[ 0 ], recipe.colors.skin ) ) continue;
			recipe.outfit.colors = paletteColors( next );
			break;

		}

	}
	return recipe;

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
		recipe.outfit.colors = paletteColors( palette );

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

function paletteColors( [ primary, secondary, accent ] ) {

	return {
		top: { primary, secondary, accent },
		pants: { primary: shade( primary, 0.88 ), secondary: shade( secondary, 0.8 ), accent },
		footwear: { primary: shade( primary, 0.6 ), secondary: shade( secondary, 0.62 ), accent }
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
