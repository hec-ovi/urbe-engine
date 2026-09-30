/*
 * A recipe in plain words: what anybody who looks at the person sees, read
 * off the same recipe the crowd paints and the focused rig wears, so what a
 * person says about their looks is what the player sees. The words are the
 * dialog layer's `look` (quests DialogLook): height, build, face features,
 * hair, skin, eyes, each garment with its colours, and the fabric.
 */
import { PANEL_OF, TOP_PANELS } from './TopPanels.js';

/** A garment's name as people say it. */
const GARMENT_WORDS = {
	'tech-top': 'fitted technical top', 'police-jacket': 'patrol jacket', 'office-jacket': 'suit jacket',
	'top-tee': 'T-shirt', 'top-tank': 'tank top', 'top-turtleneck': 'turtleneck', 'jacket-cropped': 'cropped jacket',
	'vest-tailored': 'tailored vest', 'shirt-utility': 'utility shirt', 'jacket-bomber': 'bomber jacket',
	'pants-tech': 'technical trousers', 'pants-patrol': 'patrol trousers', 'pants-office': 'suit trousers',
	'pants-leggings': 'leggings', 'pants-chinos': 'chinos', 'pants-cargo': 'cargo trousers', 'pants-shorts': 'shorts',
	'pants-joggers': 'joggers',
	'boots-patrol': 'patrol boots', 'shoes-city': 'city shoes', 'sneakers-low': 'low sneakers',
	'sneakers-high': 'high-top sneakers', 'boots-chelsea': 'Chelsea boots', 'boots-tall': 'tall boots'
};
const FABRIC_WORDS = { tech: 'technical fabric', woven: 'woven cloth', leather: 'leather' };
/** Hairstyles by their Source name, without the teen suffix. */
const HAIR_WORDS = {
	Hair_Balding: 'thinning on top, cut short at the sides', Hair_Buzzed: 'in a buzz cut', Hair_Dreads: 'in dreadlocks',
	Hair_Mohawk: 'in a mohawk', Hair_Ponytail: 'tied back in a ponytail', Hair_SimpleParted: 'short, with a side parting',
	Hair_SlickBack: 'slicked back', Hair_Bob: 'cut in a bob', Hair_Buns: 'up in buns', Hair_BuzzedFemale: 'in a buzz cut',
	Hair_Long: 'long and loose', Hair_LongDreads: 'in long dreadlocks', Hair_Ponytail_2: 'tied back in a ponytail'
};
const FACIAL_WORDS = { Hair_Beard: 'a beard', Hair_Moustache: 'a moustache', Hair_MuttonChops: 'mutton-chop sideburns' };
/** The generator's skin, hair and eye palettes by name (Recipe SKIN_COLORS, HAIR_COLORS, EYE_COLORS). */
const SKIN_WORDS = {
	'#edc6ac': 'fair', '#d8ad8d': 'light', '#bd8b68': 'light brown', '#a77550': 'tan brown',
	'#895735': 'brown', '#66452f': 'dark brown', '#4b3026': 'deep brown'
};
const HAIR_COLOR_WORDS = {
	'#191a20': 'black', '#272321': 'near-black', '#4b3125': 'dark brown', '#7f5639': 'chestnut brown',
	'#b68d54': 'honey blond', '#d2c0a0': 'fair blond', '#867d79': 'grey', '#473e55': 'dyed plum'
};
const EYE_WORDS = {
	'#453c30': 'dark brown', '#684a2e': 'brown', '#81907a': 'hazel green', '#65756a': 'grey-green',
	'#738ea1': 'blue-grey', '#727580': 'grey', '#afa17e': 'amber'
};
/** A shape control this far from neutral is worth a word; the face keeps the studio's spread, the body the street's narrower one. */
const FACE_NOTE = 0.06;
const BODY_NOTE = 0.03;

/**
 * The recipe as a person's look in words:
 * `{ height, build, face, hair, skin, eyes, wearing, fabric }`.
 */
export function describeLook( recipe ) {

	const { shape, colors, outfit } = recipe;
	const female = recipe.body.includes( 'female' );
	return {
		height: shape.height < 0.975 ? 'short' : shape.height > 1.025 ? 'tall' : 'of average height',
		build: build( shape, female ),
		face: face( shape ),
		hair: hair( recipe.hair, colors.hair ),
		skin: SKIN_WORDS[ colors.skin ] ?? skinTone( colors.skin ),
		eyes: EYE_WORDS[ colors.eyes ] ?? colorName( colors.eyes ),
		wearing: wearing( outfit ),
		fabric: FABRIC_WORDS[ outfit.fabric ] ?? outfit.fabric
	};

}

/** "a slim build", "a heavy build with broad shoulders", "an average build with wide hips". */
function build( shape, female ) {

	const mass = ( shape.build + shape.thickness + shape.chest + shape.waist ) / 4 - 1;
	const frame = mass < - BODY_NOTE ? 'a slim build' : mass > BODY_NOTE ? 'a heavy build' : 'an average build';
	const notes = [];
	if ( shape.shoulders - 1 > BODY_NOTE ) notes.push( 'broad shoulders' );
	else if ( 1 - shape.shoulders > BODY_NOTE ) notes.push( 'narrow shoulders' );
	if ( shape.hips - 1 > BODY_NOTE ) notes.push( 'wide hips' );
	else if ( female && 1 - shape.hips > BODY_NOTE ) notes.push( 'narrow hips' );
	if ( shape.legs - 1 > BODY_NOTE ) notes.push( 'long legs' );
	return notes.length ? `${frame} with ${listed( notes )}` : frame;

}

/** The two face features furthest from neutral, when they are worth a word. */
function face( shape ) {

	const features = [
		[ 'faceWidth', 'a broad face', 'a narrow face' ], [ 'jawWidth', 'a strong, wide jaw', 'a narrow jaw' ],
		[ 'noseSize', 'a large nose', 'a small nose' ], [ 'mouthWidth', 'a wide mouth', 'a small mouth' ],
		[ 'eyeSize', 'large eyes', 'small eyes' ], [ 'eyeSpacing', 'wide-set eyes', 'close-set eyes' ]
	].map( ( [ key, more, less ] ) => ( { off: shape[ key ] - 1, more, less } ) )
		.filter( ( { off } ) => Math.abs( off ) >= FACE_NOTE )
		.sort( ( a, b ) => Math.abs( b.off ) - Math.abs( a.off ) );
	return features.slice( 0, 2 ).map( ( { off, more, less } ) => off > 0 ? more : less );

}

/** "black hair, slicked back", "no hair: a shaved head", "dark brown hair in dreadlocks, and a beard". */
function hair( path, hex ) {

	const name = /Hair_[A-Za-z0-9]+(?:_2)?/.exec( path ?? '' )?.[ 0 ]?.replace( /_Teen$/, '' ) ?? '';
	const color = HAIR_COLOR_WORDS[ hex ] ?? colorName( hex );
	if ( FACIAL_WORDS[ name ] ) return `a shaved head and ${color} ${FACIAL_WORDS[ name ]}`;
	if ( ! name || ! HAIR_WORDS[ name ] ) return 'none: a shaved head';
	const style = HAIR_WORDS[ name ];
	return style.startsWith( 'in ' ) || style.startsWith( 'up ' ) || style.startsWith( 'tied' ) || style.startsWith( 'cut' )
		? `${color} hair ${style}` : `${color} hair, ${style}`;

}

/** Each garment top to toe with its colours: "a navy bomber jacket with slate-grey shoulders", "charcoal joggers". */
function wearing( outfit ) {

	const worn = [];
	const top = outfit.top && outfit.top !== 'none' ? outfit.top : null;
	if ( top ) {

		const main = colorName( outfit.colors.top.primary );
		const second = colorName( outfit.colors.top.secondary );
		const panel = TOP_PANELS[ PANEL_OF[ top ] ?? 'plain' ];
		const words = GARMENT_WORDS[ top ] ?? top;
		const detail = second === main || panel === TOP_PANELS.plain ? ''
			: panel === TOP_PANELS.open ? ` open over a ${second} front`
				: panel === TOP_PANELS.sleeved ? ` with ${second} shoulders and sleeves` : ` with ${second} shoulders`;
		worn.push( `${article( main )} ${main} ${words}${detail}` );

	} else worn.push( 'nothing on top' );
	for ( const slot of [ 'pants', 'footwear' ] ) {

		const id = outfit[ slot ];
		if ( ! id || id === 'none' ) {

			worn.push( slot === 'pants' ? 'nothing on the legs' : 'bare feet' );
			continue;

		}
		worn.push( `${colorName( outfit.colors[ slot ].primary )} ${GARMENT_WORDS[ id ] ?? id}` );

	}
	return worn;

}

/** A skin colour outside the generator's palette by its lightness. */
function skinTone( hex ) {

	const [ , , light ] = hsl( hex );
	return light > 0.75 ? 'fair' : light > 0.6 ? 'light' : light > 0.45 ? 'tan brown' : light > 0.3 ? 'brown' : 'deep brown';

}

/**
 * A colour's everyday name: its hue family with light or dark as it reads,
 * greys and near-blacks by lightness. "navy", "dark teal", "light grey",
 * "charcoal", "sand".
 */
export function colorName( hex ) {

	const [ hue, saturation, light ] = hsl( hex );
	if ( light < 0.1 ) return 'black';
	if ( light > 0.92 && saturation < 0.25 ) return 'white';
	if ( saturation < 0.12 || ( saturation < 0.2 && light < 0.25 ) ) {

		if ( light < 0.22 ) return 'charcoal';
		if ( light < 0.4 ) return 'dark grey';
		if ( light < 0.62 ) return 'grey';
		if ( light < 0.8 ) return 'light grey';
		return 'off-white';

	}
	const family = hueName( hue, saturation, light );
	if ( [ 'navy', 'maroon', 'brown', 'olive', 'sand', 'cream', 'slate', 'plum', 'khaki' ].includes( family ) ) return family;
	if ( light < 0.28 ) return `dark ${family}`;
	if ( light > 0.7 ) return `pale ${family}`;
	if ( light > 0.55 ) return `light ${family}`;
	return family;

}

function hueName( hue, saturation, light ) {

	if ( hue < 15 || hue >= 345 ) return light < 0.3 ? 'maroon' : 'red';
	if ( hue < 40 ) {

		if ( saturation < 0.45 && light > 0.55 ) return light > 0.75 ? 'cream' : 'sand';
		return light < 0.45 ? 'brown' : 'orange';

	}
	if ( hue < 65 ) {

		if ( saturation < 0.45 ) return light > 0.7 ? 'cream' : light > 0.45 ? 'khaki' : 'olive';
		return light < 0.35 ? 'olive' : 'yellow';

	}
	if ( hue < 160 ) return saturation < 0.25 ? ( light > 0.45 ? 'sage green' : 'olive' ) : 'green';
	if ( hue < 195 ) return 'teal';
	if ( hue < 255 ) {

		if ( saturation < 0.35 ) return light < 0.3 ? 'navy' : 'slate';
		return light < 0.3 ? 'navy' : 'blue';

	}
	if ( hue < 290 ) return saturation < 0.25 ? 'mauve grey' : 'purple';
	if ( hue < 345 ) return light < 0.35 ? 'plum' : saturation < 0.3 ? 'mauve' : 'pink';
	return 'red';

}

function hsl( hex ) {

	const [ r, g, b ] = hex.slice( 1 ).match( /../g ).map( ( channel ) => parseInt( channel, 16 ) / 255 );
	const max = Math.max( r, g, b );
	const min = Math.min( r, g, b );
	const light = ( max + min ) / 2;
	const delta = max - min;
	if ( delta === 0 ) return [ 0, 0, light ];
	const saturation = delta / ( 1 - Math.abs( 2 * light - 1 ) );
	let hue;
	if ( max === r ) hue = ( ( g - b ) / delta ) % 6;
	else if ( max === g ) hue = ( b - r ) / delta + 2;
	else hue = ( r - g ) / delta + 4;
	return [ ( hue * 60 + 360 ) % 360, saturation, light ];

}

function article( word ) {

	return /^[aeiou]/i.test( word ) ? 'an' : 'a';

}

function listed( items ) {

	return items.length < 2 ? items.join( '' ) : `${items.slice( 0, - 1 ).join( ', ' )} and ${items.at( - 1 )}`;

}
