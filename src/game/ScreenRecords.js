/**
 * What the inventory and the codex show, projected from what the game holds:
 * the carried items, the people the player has talked to, the places they
 * have stood in and the quests those belong to. Presentation records only;
 * nothing here changes game state.
 */

/** Colour of a mission model's material by its variant, else its family (`cyberpunk/<family>/...`). */
const VARIANT_TONES = { paint: '#56656b', zinc: '#b7c1c3', chrome: '#c7cfd1', steel: '#9aa6aa', brass: '#bc9d64', gold: '#c9a85c', copper: '#b87333', matte: '#3a474c' };
const FAMILY_TONES = { metal: '#8f9ca1', plastic: '#3f5156', paper: '#d5c8a9', fabric: '#6d7c83', leather: '#6b4a33', wood: '#8a6a48', glass: '#9fc7d0', rubber: '#2a3236', stone: '#9a9a92', concrete: '#8d8f88' };

/** The exact boxes a quest item's mission asset is built from, coloured for a still preview; null without one. */
export function itemModel( assembly ) {

	const primitives = assembly?.geometry?.primitives;
	if ( ! primitives?.length ) return null;
	const tones = new Map( ( assembly.materials ?? [] ).map( ( material ) => [ material.slot, toneOf( material ) ] ) );
	return {
		parts: primitives.map( ( primitive ) => ( {
			size: [ primitive.size.width, primitive.size.height, primitive.size.depth ],
			position: [ primitive.position.x, primitive.position.y, primitive.position.z ],
			rotation: [ primitive.rotationRadians?.x ?? 0, primitive.rotationRadians?.y ?? 0, primitive.rotationRadians?.z ?? 0 ],
			color: tones.get( primitive.materialSlot ) ?? FAMILY_TONES.plastic
		} ) )
	};

}

function toneOf( { key = '', variantId = '' } ) {

	const variant = Object.keys( VARIANT_TONES ).find( ( word ) => variantId.includes( word ) );
	if ( variant ) return VARIANT_TONES[ variant ];
	const family = key.split( '/' )[ 1 ] ?? '';
	return FAMILY_TONES[ family ] ?? FAMILY_TONES.plastic;

}

/** The quests by id as the journal lists them: `{ title, kind }`. */
function questIndex( quests ) {

	return new Map( quests.map( ( quest ) => [ quest.id, { title: quest.title, kind: quest.kind ?? 'side' } ] ) );

}

/**
 * The inventory's cards: each carried item with its quantity, the quests it
 * belongs to (main or side) and, for a quest item with a mission asset, its
 * exact model. `items` are the merged inventory records, `quests` the
 * journal's view, `assetOf( questId, itemId )` the mission assembly or null.
 */
export function inventoryCards( items, quests, assetOf = () => null ) {

	const index = questIndex( quests );
	return items.map( ( item ) => {

		const questIds = item.state?.questlineIds ?? [];
		const model = questIds.map( ( questId ) => itemModel( assetOf( questId, item.id ) ) ).find( Boolean ) ?? null;
		return {
			id: item.id,
			name: item.name,
			kind: item.state?.kind ?? '',
			description: item.state?.description ?? '',
			place: item.state?.place ?? '',
			quantity: item.quantity ?? 1,
			quests: [ ...new Set( questIds ) ].filter( ( id ) => index.has( id ) ).map( ( id ) => ( { id, ...index.get( id ) } ) ),
			...( model ? { model } : {} )
		};

	} );

}

/**
 * The people the player has talked to, in the order met: a record per person
 * as the codex reads it. `met(npcId, record)` notes a conversation; a person
 * known from a saved game's memory of talks comes in through `remember`.
 */
export class Acquaintances {

	constructor() {

		this.people = new Map();

	}

	/** A conversation with this person now: `{ name, role, place, timeMin }`. */
	met( npcId, { name, role = '', place = '', timeMin = null } ) {

		const known = this.people.get( npcId );
		this.people.set( npcId, {
			npcId, name, role: role || known?.role || '',
			firstPlace: known?.firstPlace || place, lastPlace: place || known?.lastPlace || '',
			talks: ( known?.talks ?? 0 ) + 1, lastMin: timeMin ?? known?.lastMin ?? null, line: known?.line ?? ''
		} );

	}

	/**
	 * Somebody the saved game remembers talking to: the memory's turns give
	 * how often and the last thing they said. `name` and `role` come from the
	 * simulation's person; a person with neither is left out.
	 */
	remember( npcId, turns, { name, role = '' } ) {

		if ( ! name ) return;
		const said = turns.filter( ( turn ) => turn.speaker === 'npc' );
		const known = this.people.get( npcId );
		this.people.set( npcId, {
			npcId, name: known?.name ?? name, role: known?.role || role,
			firstPlace: known?.firstPlace ?? '', lastPlace: known?.lastPlace ?? '',
			talks: Math.max( known?.talks ?? 0, turns.filter( ( turn ) => turn.speaker === 'player' ).length ),
			lastMin: Math.max( known?.lastMin ?? - Infinity, ...turns.map( ( turn ) => turn.atMin ?? - Infinity ) ),
			line: said.at( - 1 )?.text ?? known?.line ?? ''
		} );

	}

	get size() {

		return this.people.size;

	}

	[ Symbol.iterator ]() {

		return this.people.values();

	}

}

/**
 * The codex's records: items (from the inventory's cards), people (the
 * acquaintances, with the quests that cast them) and places (the lots and
 * districts stood in, with the quests whose steps are there).
 * @param cards inventoryCards(...)
 * @param people Acquaintances
 * @param places [{ id, name, use?, district? }]
 * @param quests the journal's view, whose steps carry `npcName` and `place`
 * @param castOf( npcId ) the quest ids that cast this person
 * @param personaOf( npcId ) how their story describes them, or null; its first sentence opens their record
 */
export function codexEntries( { cards = [], people = [], places = [], quests = [], castOf = () => [], personaOf = () => null } ) {

	const index = questIndex( quests );
	const story = ( ids ) => [ ...new Set( ids ) ].filter( ( id ) => index.has( id ) )
		.map( ( id ) => ( { quest: id, title: index.get( id ).title, kind: index.get( id ).kind } ) );

	const items = cards.map( ( card ) => ( {
		id: `item:${card.id}`,
		category: 'items',
		title: card.name,
		summary: card.description || card.kind,
		text: card.description,
		facts: [
			...( card.kind ? [ { label: 'Kind', value: card.kind } ] : [] ),
			{ label: 'Carried', value: String( card.quantity ?? 1 ) }
		],
		...( card.place ? { location: card.place } : {} ),
		...( card.kind ? { tags: [ card.kind ] } : {} ),
		...( card.model ? { model: card.model } : {} ),
		related: card.quests.map( ( quest ) => ( { quest: quest.id, title: quest.title, kind: quest.kind } ) )
	} ) );

	// Two lots under one sign word are told apart by their lot.
	const names = new Map();
	for ( const place of places ) names.set( displayName( place.name ), ( names.get( displayName( place.name ) ) ?? 0 ) + 1 );
	const placeEntries = places.map( ( place ) => {

		const name = displayName( place.name );
		const here = quests.filter( ( quest ) => quest.steps?.some( ( step ) => step.place?.id === place.id || step.place?.parcelId === place.id ) ).map( ( quest ) => quest.id );
		return {
			id: `place:${place.id}`,
			category: 'places',
			title: names.get( name ) > 1 && place.use ? `${name} · ${place.id}` : name,
			summary: [ place.use, place.district ].filter( Boolean ).join( ' · ' ),
			text: place.district ? `${place.use ? `A ${place.use} lot` : 'A place'} in ${place.district}.` : 'A district of the city.',
			facts: [
				...( place.use ? [ { label: 'Use', value: place.use } ] : [] ),
				...( place.district ? [ { label: 'District', value: place.district } ] : [] )
			],
			...( place.use ? { tags: [ place.use ] } : {} ),
			...( place.use ? {} : { model: { shape: 'map' } } ),
			related: story( here )
		};

	} );

	const peopleEntries = [ ...people ].map( ( person ) => {

		const cast = castOf( person.npcId );
		const talks = person.talks === 1 ? 'Once' : `${person.talks} times`;
		return {
			id: `person:${person.npcId}`,
			category: 'people',
			title: person.name,
			subtitle: person.role,
			summary: person.role ? `${capital( person.role )}${person.lastPlace ? `, met at ${person.lastPlace}` : ''}` : person.lastPlace,
			text: [
				firstSentence( personaOf( person.npcId ) ),
				cast.length
					? `${person.name} has a part in ${cast.map( ( id ) => index.get( id )?.title ).filter( Boolean ).join( ' and ' )}.`
					: `Somebody you have talked with${person.lastPlace ? ` at ${person.lastPlace}` : ''}.`
			].filter( Boolean ).join( '\n\n' ),
			facts: [
				...( person.role ? [ { label: 'Role', value: person.role } ] : [] ),
				{ label: 'Talked', value: talks },
				...( person.lastPlace ? [ { label: 'Last seen at', value: person.lastPlace } ] : [] )
			],
			...( person.line ? { quote: person.line, source: 'The last thing they said to you' } : {} ),
			...( person.role ? { tags: [ person.role ] } : {} ),
			related: story( cast )
		};

	} );

	return [ ...items, ...peopleEntries, ...placeEntries ];

}

/** A sign's capitals read as a name; a district's label starts with a capital. */
function displayName( text = '' ) {

	return capital( /[a-z]/.test( text ) ? text : text.toLowerCase().replace( /\b\w/g, ( letter ) => letter.toUpperCase() ) );

}

function firstSentence( text ) {

	return text ? text.match( /^.*?[.!?](?=\s|$)/ )?.[ 0 ] ?? text : '';

}

function capital( text ) {

	return text ? text[ 0 ].toUpperCase() + text.slice( 1 ) : text;

}
