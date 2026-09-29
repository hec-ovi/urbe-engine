import sources from './templates/index.js';
import { RECIPE_FORMAT, defaultRecipe, normalizeRecipe } from './Recipe.js';

/** No authored outfit may dress more of the street than this, all of them together. */
const CROWD_LIMIT = 0.5;
const NAME_LIMIT = 80;

/**
 * The authored characters (templates/index.js), checked once: whole people a
 * named identity is drawn as, and outfits the crowd wears in its share.
 */
export class AvatarTemplates {

	/** @param entries `{ id: file }`, each file a studio recipe or a template (templates/index.js) */
	constructor( entries = sources ) {

		this.list = Object.entries( entries ).map( ( [ id, file ] ) => template( id, file ) );
		this.people = new Map();
		for ( const entry of this.list ) for ( const npcId of entry.people ) {

			if ( this.people.has( npcId ) ) throw new TypeError( `${npcId} is both ${this.people.get( npcId ).name} and ${entry.name}` );
			if ( ! entry.recipe ) throw new TypeError( `${entry.name} is an outfit and names no person's body` );
			this.people.set( npcId, entry );

		}
		const share = this.list.reduce( ( sum, entry ) => sum + entry.crowd, 0 );
		if ( share > CROWD_LIMIT ) throw new TypeError( `authored outfits dress ${share} of the street, more than ${CROWD_LIMIT}` );
		/** What the crowd wears in its share: `{ outfit, share }`, in file order. */
		this.outfits = this.list.filter( ( entry ) => entry.crowd > 0 ).map( ( entry ) => ( { outfit: entry.outfit, share: entry.crowd } ) );

	}

	/** The template going by an id or a name, or null. */
	named( key ) {

		return this.list.find( ( entry ) => entry.id === key || entry.name === key ) ?? null;

	}

	/** The authored person a simulation identity is, or null. */
	forPerson( npcId ) {

		return npcId ? this.people.get( npcId ) ?? null : null;

	}

}

function template( id, file ) {

	if ( ! file || typeof file !== 'object' ) throw new TypeError( `template ${id} is not an object` );
	const bare = file.format === RECIPE_FORMAT;
	const name = bare ? title( id ) : file.name;
	if ( typeof name !== 'string' || ! name.trim() || name.length > NAME_LIMIT ) throw new TypeError( `template ${id} has no usable name` );
	if ( ! bare && Boolean( file.recipe ) === Boolean( file.outfit ) ) throw new TypeError( `${name} needs either a recipe or an outfit` );
	const crowd = bare ? 0 : file.crowd ?? 0;
	if ( ! Number.isFinite( crowd ) || crowd < 0 || crowd > CROWD_LIMIT ) throw new TypeError( `${name}: crowd share must be 0 to ${CROWD_LIMIT}` );
	const people = bare ? [] : file.people ?? [];
	if ( ! Array.isArray( people ) || people.some( ( npcId ) => typeof npcId !== 'string' || ! npcId ) ) throw new TypeError( `${name}: people must be npcIds` );
	const recipe = bare ? normalizeRecipe( file ) : file.recipe ? normalizeRecipe( file.recipe ) : null;
	// An outfit is checked by the recipe it would make on a default body.
	const outfit = recipe?.outfit ?? normalizeRecipe( { ...defaultRecipe(), outfit: file.outfit } ).outfit;
	return Object.freeze( { id, name: name.trim(), recipe, outfit, crowd, people: [ ...people ] } );

}

/** `district-liaison` as `District liaison`. */
function title( id ) {

	const words = id.replace( /\.json$/, '' ).split( /[-_\s]+/ ).filter( Boolean );
	return words.map( ( word, index ) => index ? word : word[ 0 ].toUpperCase() + word.slice( 1 ) ).join( ' ' );

}
