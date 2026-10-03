/**
 * Who may open which door. A locked door has a scope; a card grants scopes;
 * a person holds scopes by where they live and the post they work.
 *
 * Scopes, by the doors they open:
 * - `home:<parcel>/<home>`: one dwelling's entrance (`floor:<i>/<unit>`, the simulation's `home.apartment.id`);
 * - `homes:<parcel>`: every dwelling's entrance in that building, a building master card;
 * - `staff:<parcel>`: its offices, executive offices, kitchens behind the counter and archives;
 * - `service:<parcel>`: its storage and plant rooms;
 * - `security:<parcel>`: its security, server and control rooms.
 *
 * Lobbies, galleries, shops, bars, receptions, cafés, corridors, open
 * offices and meeting rooms have no scope: their doors stay open to anyone.
 */

/** The scope kinds a person working a building holds, by their post. */
const ROLE_SCOPES = Object.freeze( {
	security: [ 'staff', 'service', 'security', 'homes' ],
	receptionist: [ 'staff', 'service', 'homes' ],
	cleaner: [ 'staff', 'service' ],
	executive: [ 'staff', 'security' ],
	resident: [],
	guest: []
} );
const WORKER = [ 'staff' ];
/** The order cards are told and offered in: a home first, a master card last. */
const ORDER = [ 'home', 'staff', 'service', 'security', 'homes' ];

/** A scope's kind and building: `{ kind, parcelId, home? }`, or null for anything else. */
export function parseScope( scope ) {

	const match = /^(home|homes|staff|service|security):([^/]+)(?:\/(.+))?$/.exec( String( scope ?? '' ) );
	if ( ! match ) return null;
	const [ , kind, parcelId, home ] = match;
	if ( ( kind === 'home' ) !== Boolean( home ) ) return null;
	return { kind, parcelId, ...( home ? { home } : {} ) };

}

/** Whether a set of granted scopes opens a door of `scope`: the scope itself, or a dwelling by its building's master card. */
export function grants( held, scope ) {

	if ( ! scope ) return true;
	if ( held.has( scope ) ) return true;
	const parsed = parseScope( scope );
	return parsed?.kind === 'home' && held.has( `homes:${parsed.parcelId}` );

}

/**
 * The scopes a person holds: their own dwelling's, and their workplace's by
 * their post there (every worker the staff rooms; cleaners and front desks
 * the service rooms too; security the security rooms; the front desk and
 * security of a building with homes a master card for them). Ordered as
 * cards are told, home first.
 * @param npc the simulation's person: `home.apartment`, `job.parcelId`, `job.role`
 * @param book the AddressBook, to know which buildings have locked doors at all
 */
export function scopesOf( npc, book = null ) {

	const scopes = [];
	const apartment = npc?.home?.apartment;
	if ( apartment ) scopes.push( `home:${npc.home.parcelId}/${apartment.id}` );
	const job = npc?.job;
	if ( job?.parcelId ) {

		const building = book?.building( job.parcelId ) ?? null;
		// A card for doors the building does not have is no card at all: a building with no furnished floors has none.
		const locked = new Set( ( building?.units ?? [] ).map( ( unit ) => parseScope( unit.scope )?.kind === 'home' ? 'homes' : parseScope( unit.scope )?.kind ) );
		for ( const kind of ROLE_SCOPES[ job.role ] ?? WORKER ) {

			if ( ! locked.has( kind ) ) continue;
			scopes.push( `${kind}:${job.parcelId}` );

		}

	}
	return [ ...new Set( scopes ) ].sort( ( a, b ) => ORDER.indexOf( parseScope( a ).kind ) - ORDER.indexOf( parseScope( b ).kind ) );

}

/** The scope a door needs, or null for a door anyone opens: its own, else an apartment entrance's dwelling. */
export function scopeOfDoor( door ) {

	if ( ! door ) return null;
	if ( door.scope !== undefined ) return door.scope;
	if ( door.role === 'apartment' && door.parcelId && door.unit !== undefined && Number.isInteger( door.floor ) ) return `home:${door.parcelId}/floor:${door.floor}/${door.unit}`;
	return null;

}

/**
 * What a scope opens, in words for a card, a prompt and a person's talk:
 * `label` (what a card says on it), `place` (the door's own name, for the
 * prompt), `opens` (what it opens without the building, for a person who
 * carries it), `access` (what it opens, with the building) and the
 * building it belongs to.
 * @param book the AddressBook the scope's building is in
 */
export function describeScope( scope, book ) {

	const parsed = parseScope( scope );
	if ( ! parsed ) return null;
	const building = book?.building( parsed.parcelId ) ?? null;
	const name = building?.name ?? 'the building';
	const short = building?.short ?? 'Building';
	if ( parsed.kind === 'home' ) {

		const unit = book?.unit( `apartment:${parsed.parcelId}:${parsed.home}` ) ?? null;
		const place = unit?.label ?? 'the apartment';
		return { scope, kind: 'home', parcelId: parsed.parcelId, label: `${unit?.short ?? short} key card`, place, opens: place, access: unit?.address ?? `${place} in ${name}`, building: name };

	}
	const rooms = ( building?.units ?? [] ).filter( ( unit ) => unit.scope === scope ).map( ( unit ) => unit.label );
	const words = { homes: 'every apartment', staff: 'the staff rooms', service: 'the service rooms', security: 'the security rooms' }[ parsed.kind ];
	const title = { homes: 'master card', staff: 'staff card', service: 'service card', security: 'security card' }[ parsed.kind ];
	const which = rooms.length && rooms.length <= 3 ? ` (${rooms.join( ', ' )})` : rooms.length ? ` (${rooms.slice( 0, 3 ).join( ', ' )} and ${rooms.length - 3} more)` : '';
	return { scope, kind: parsed.kind, parcelId: parsed.parcelId, label: `${short} ${title}`, place: `${words} of ${name}`, opens: `${words}${which}`, access: `${words} of ${name}${which}`, building: name };

}

/**
 * The card a person hands over, or the player lifts or finds, for one scope:
 * an inventory item of kind `access-card` whose data names its grants, who
 * issued it and what it opens. A copy of a scope is always the same item, so
 * the player carries one card per scope however many they are given.
 * @param scope the scope it grants
 * @param issuer `{ npcId?, name }`, whose card it is
 * @param how `given`, `stolen`, `found` or `quest`
 */
export function cardFor( scope, { book, issuer = null, how = 'given', atMin = null } = {} ) {

	const words = describeScope( scope, book );
	if ( ! words ) return null;
	return {
		id: `card:${scope}`, kind: 'access-card', label: words.label,
		data: {
			grants: [ scope ], access: words.access,
			...( issuer ? { issuer: { ...( issuer.npcId ? { npcId: issuer.npcId } : {} ), name: issuer.name } } : {} ),
			how, ...( Number.isFinite( atMin ) ? { atMin } : {} )
		}
	};

}

/**
 * Whether a person gives the player a copy of one of their cards when
 * nobody can ask the model for them: only a friendly person, and only their
 * own home's, which is as private as their home (Quests `willingTo`). With a
 * model, the person decides in their own words (Quests `give_item`).
 */
export function givesCard( disposition, scope ) {

	return disposition === 'friendly' && parseScope( scope )?.kind === 'home';

}

/**
 * The doors the player may open: the scopes of the access cards they carry
 * (the player's own items) and of the quest items that open a door (Quests
 * `opens`). `lockOf(door, feet)` says whether a door is locked to them.
 */
export class PlayerAccess {

	/**
	 * @param items the player's PlayerItems
	 * @param questCards `() => [{ id, name, scope }]`, quest items the player holds that open a door
	 * @param book the AddressBook
	 */
	constructor( { items, questCards = () => [], book = null } ) {

		this.items = items;
		this.questCards = questCards;
		this.book = book;

	}

	/** Every scope the player holds now. */
	held() {

		const held = new Set();
		for ( const card of this.items.ofKind( 'access-card' ) ) for ( const scope of card.data?.grants ?? [] ) held.add( scope );
		for ( const card of this.questCards() ) if ( card.scope ) held.add( card.scope );
		return held;

	}

	/** Whether the player holds this scope. */
	holds( scope ) {

		return grants( this.held(), scope );

	}

	/**
	 * A door's lock as the player stands: null for a door anyone opens;
	 * otherwise `{ scope, place, locked }`, `locked` false when the player
	 * holds a card for it or stands on its private side, where a lock never
	 * keeps anybody in.
	 */
	lockOf( door, feet = null ) {

		const scope = scopeOfDoor( door );
		if ( ! scope ) return null;
		const place = door.place ?? door.name ?? describeScope( scope, this.book )?.place ?? 'this door';
		const inside = Boolean( feet && door.inward && door.center &&
			( feet.x - door.center.x ) * door.inward[ 0 ] + ( feet.z - door.center.z ) * door.inward[ 1 ] > 0 );
		return { scope, place, locked: ! inside && ! this.holds( scope ) };

	}

}
