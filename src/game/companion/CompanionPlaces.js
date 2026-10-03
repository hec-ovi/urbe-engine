import { VENUES } from '../../../../quests/dist/runtime.js';
import { COMPASS } from './CompanionLines.js';

/** Farthest a person leads the player, along the pavement, in metres. */
const MAX_LEAD = 800;
/** A place nearer than this along the pavement is where the person already stands. */
const MIN_LEAD = 10;
/** Most places one person offers to show; a talk hears of more, any of which the player may ask for by name. */
const MAX_PLACES = 4;
const MAX_TALK_PLACES = 16;
/** Most of each wider kind a talk hears of: spots in the building, people, venues, stops and streets. */
const MAX_OF_KIND = { spot: 5, unit: 4, person: 4, venue: 5, stop: 2, street: 4 };
/** How far off, straight, a venue, stop or street may lie to be one a talk hears of. */
const NEAR = 450;
/** Open quest places first, then staged scenes, then the person's own life, then what a talk may also ask for. */
const RANK = { quest: 0, scene: 1, work: 2, home: 3, haunt: 4, spot: 5, person: 6, venue: 7, stop: 8, street: 9 };
/** Rooms nobody is led to by name. */
const UNSHOWN = new Set( [ 'corridor', 'elevator_lobby', 'mechanical_room', 'storage', 'stair', 'shaft' ] );

/**
 * Where one person could take the player: the places of open quest steps and
 * staged scenes, their workplace, home and haunts, each one they can walk to
 * within MAX_LEAD, in a fixed order.
 */
export class CompanionPlaces {

	/**
	 * @param atlas the city plan: parcels with their type and optional name, transit stops and stations
	 * @param places continuity places `{ kind, id, position, doorstep? }`: a leader stops at a
	 *   place's doorstep, outside its entrance, else at its position
	 * @param routes the WalkRoutes the walk there is measured on
	 * @param lines CompanionLines, which name what has no name of its own
	 */
	/**
	 * @param inside optional `{ plan(parcelId), workSpot(npc) }`: a building's
	 *   circulation (InteriorRoutes `plan`) and the spot a person works at, a
	 *   `{ position, parcelId, floor }` inside their workplace, or null
	 * @param streets optional Quests StreetNames over the city's streets
	 * @param people optional `(npc) => [{ npcId, name, position }]`, the people this person knows whose bodies are placed now
	 * @param addresses optional AddressBook: a person's home and work go by their address, and a
	 *   talk's line may name a dwelling or private room by its number
	 */
	constructor( { atlas, places, routes, lines, inside = null, streets = null, people = null, addresses = null } ) {

		this.addresses = addresses;
		this.routes = routes;
		this.lines = lines;
		this.inside = inside;
		this.streets = streets;
		this.people = people;
		this.atlas = atlas;
		this.positions = new Map( places.map( ( place ) => [ keyOf( place ), place.doorstep ?? place.position ] ) );
		this.parcels = new Map( atlas.parcels.map( ( parcel ) => [ parcel.id, parcel ] ) );
		const transit = atlas.transit ?? {};
		this.stops = new Map( [
			...( transit.busStops ?? [] ).map( ( stop ) => [ stop.id, { name: stop.name, key: 'name-stop' } ] ),
			...[ ...( transit.trainStations ?? [] ), ...( transit.subwayStations ?? [] ) ]
				.map( ( station ) => [ station.id, { name: station.name, key: 'name-station' } ] )
		] );

	}

	/** The name the player sees for a place: its own, else what it is; null for a place the city does not hold. */
	name( place ) {

		if ( place.kind === 'stop' ) {

			const stop = this.stops.get( place.id );
			return stop ? stop.name ?? this.lines.say( stop.key ) : null;

		}
		const parcel = this.parcels.get( place.id );
		if ( parcel?.name ) return parcel.name;
		const word = VENUES[ parcel?.type ]?.word;
		return word ? this.lines.say( 'name-unnamed', { word } ) : null;

	}

	/**
	 * The places one person could lead the player to from `from`, best first:
	 * by relation, then by the length of the walk, then by place id. A place
	 * the player stands in, one the city cannot place or name, and one out of
	 * reach are left out, and so is one that reads the same as a better place
	 * in name, way and walk, unless it is a quest place. Offered places that
	 * share a name carry `offeredAs`, which adds the compass point they lie
	 * toward (`the shop to the north`) and, for two that lie the same way, the
	 * walk (`the shop to the north, 240 m away`).
	 * @param npc the simulation instance: job, transit job, home and routine
	 * @param quests open quest place targets `{ questId, stepId, place }`
	 * @param scenes staged scenery places `{ place, name, relation: 'scene', notes? }`
	 * @returns `[{ place, name, offeredAs?, relation, distance, questId?, stepId?, notes? }]`
	 */
	destinations( { npc, from, playerPlaces, quests = [], scenes = [], wide = false, here = null, line = '' } ) {

		const candidates = new Map();
		const add = ( place, relation, extra = {} ) => {

			if ( ! place ) return;
			const known = candidates.get( keyOf( place ) );
			const kept = ! known || RANK[ relation ] < RANK[ known.relation ] ? { place, relation, ...extra } : known;
			// What a scene shows stays with its place, whatever else the place is to the person.
			const notes = [ ...( known?.notes ?? [] ), ...( extra.notes ?? [] ) ];
			candidates.set( keyOf( place ), notes.length ? { ...kept, notes } : kept );

		};
		for ( const target of quests ) add( leadPlace( target.place ), 'quest', { questId: target.questId, stepId: target.stepId } );
		for ( const scene of scenes ) add( scene.place, 'scene', { name: scene.name, ...( scene.notes?.length ? { notes: scene.notes } : {} ) } );
		if ( npc.job ) {

			const spot = this.inside?.workSpot?.( npc ) ?? null;
			const work = spot ? this.addresses?.work?.( npc ) ?? null : null;
			add( { kind: 'parcel', id: npc.job.parcelId }, 'work', spot ? { target: spot, ...( work?.label ? { name: work.address } : {} ) } : {} );

		}
		if ( npc.transitJob?.place.kind === 'stop' ) add( { kind: 'stop', id: npc.transitJob.place.id }, 'work' );
		const door = this.#apartmentDoor( npc );
		// Home by its address when the person lives in a numbered dwelling: the leader takes the player to its door.
		const home = door ? this.addresses?.home?.( npc ) ?? null : null;
		add( { kind: 'parcel', id: npc.home.parcelId }, 'home', door ? { target: door, ...( home ? { name: home.address } : {} ) } : {} );
		for ( const entry of npc.routine ) {

			if ( ( entry.activity === 'leisure' || entry.activity === 'shopping' ) && entry.place.kind === 'parcel' ) add( entry.place, 'haunt' );

		}

		const found = [];
		for ( const [ key, candidate ] of candidates ) {

			// A place inside a building is measured to the point inside, through its door: shown whatever the player stands in.
			const inner = candidate.target?.position ?? null;
			const position = this.positions.get( key );
			if ( ! position || ( ! inner && standsIn( playerPlaces, candidate.place ) ) || flat( from, position ) > MAX_LEAD ) continue;
			const name = candidate.name ?? this.name( candidate.place );
			const route = name ? this.routes.route( from, position ) : null;
			if ( ! route || route.distanceMeters > MAX_LEAD || ( route.distanceMeters < MIN_LEAD && ! inner ) ) continue;
			const distance = route.distanceMeters;
			found.push( { ...candidate, name, distance, point: bearing( from, position ), metres: Math.round( distance / 10 ) * 10 } );

		}
		if ( wide ) found.push( ...this.#wider( npc, from, here, new Set( found.map( ( entry ) => keyOf( entry.place ) ) ), line ) );
		found.sort( ( a, b ) => RANK[ a.relation ] - RANK[ b.relation ] || a.distance - b.distance || keyOf( a.place ).localeCompare( keyOf( b.place ) ) );
		const offered = [];
		const heard = new Set();
		for ( const entry of found ) {

			if ( offered.length === ( wide ? MAX_TALK_PLACES : MAX_PLACES ) ) break;
			// A place that reads the same as a better one in name, way and walk is one the player cannot tell apart.
			const words = `${entry.name}|${entry.point}|${entry.metres}`;
			if ( heard.has( words ) && entry.relation !== 'quest' ) continue;
			heard.add( words );
			offered.push( entry );

		}
		return offered.map( ( entry ) => {

			const { point, metres, ...destination } = entry;
			const alike = offered.filter( ( other ) => other !== entry && other.name === entry.name );
			if ( ! alike.length ) return destination;
			const toward = this.lines.say( `name-${point}`, { place: entry.name } );
			const offeredAs = alike.some( ( other ) => other.point === point ) ? this.lines.say( 'name-away', { place: toward, metres } ) : toward;
			return { ...destination, offeredAs };

		} );

	}

	/**
	 * What else a talk may ask this person to take the player to: inside the
	 * building they stand in, its lifts, stairs, rooms and floors; the people
	 * they know whose bodies are placed; and nearby venues, stops and streets,
	 * each nearest first and only a few of a kind.
	 */
	#wider( npc, from, here, taken, line = '' ) {

		const out = [];
		const plan = here?.parcelId ? this.inside?.plan?.( here.parcelId ) ?? null : null;
		if ( plan ) out.push( ...this.#spots( plan, here, from ) );
		out.push( ...this.#units( npc, from, here, line ).slice( 0, MAX_OF_KIND.unit ) );
		for ( const person of ( this.people?.( npc ) ?? [] ).slice( 0, MAX_OF_KIND.person ) ) {

			out.push( { place: { kind: 'person', id: person.npcId }, name: person.name, relation: 'person', target: { npcId: person.npcId }, distance: flat( from, person.position ) } );

		}
		const near = ( kind, list ) => list.filter( ( entry ) => ! taken.has( keyOf( entry.place ) ) )
			.sort( ( a, b ) => a.distance - b.distance || keyOf( a.place ).localeCompare( keyOf( b.place ) ) ).slice( 0, MAX_OF_KIND[ kind ] );
		const venues = [];
		for ( const parcel of this.atlas.parcels ) {

			if ( parcel.type === 'residential' && ! parcel.name ) continue;
			const position = this.positions.get( `parcel:${parcel.id}` );
			if ( ! position || parcel.id === here?.parcelId || flat( from, position ) > NEAR ) continue;
			const name = this.name( { kind: 'parcel', id: parcel.id } );
			if ( name ) venues.push( { place: { kind: 'parcel', id: parcel.id }, name, relation: 'venue', distance: flat( from, position ) } );

		}
		out.push( ...near( 'venue', venues ) );
		const stops = [];
		for ( const [ id ] of this.stops ) {

			const position = this.positions.get( `stop:${id}` );
			if ( position && flat( from, position ) <= NEAR ) stops.push( { place: { kind: 'stop', id }, name: this.name( { kind: 'stop', id } ), relation: 'stop', distance: flat( from, position ) } );

		}
		out.push( ...near( 'stop', stops ) );
		const streets = [];
		for ( const street of this.streets?.streets ?? [] ) {

			if ( street.kind !== 'street' && street.kind !== 'avenue' ) continue;
			const at = this.#onStreet( street, from );
			if ( at && at.distance <= NEAR ) streets.push( { place: { kind: 'street', id: street.id }, name: street.name, relation: 'street', target: { position: at.position }, distance: at.distance } );

		}
		out.push( ...near( 'street', streets ) );
		return out.map( ( entry ) => ( { ...entry, point: bearing( from, entry.target?.position ?? from ), metres: Math.round( entry.distance / 10 ) * 10 } ) );

	}

	/** The lift and stairs on the person's floor, the rooms there by kind, and every other floor by its lift landing. */
	#spots( plan, here, from ) {

		const floor = plan.floors.find( ( entry ) => entry.index === ( here.floor ?? 0 ) ) ?? plan.floors[ 0 ];
		if ( ! floor ) return [];
		const at = ( position ) => ( { position, parcelId: here.parcelId, floor: floor.index } );
		const nearest = ( list ) => [ ...list ].sort( ( a, b ) => flat( from, a.position ) - flat( from, b.position ) )[ 0 ];
		const spots = [];
		const lift = nearest( floor.lifts );
		if ( lift ) spots.push( { place: { kind: 'spot', id: `lift:${lift.id}` }, name: this.lines.say( 'name-lift' ), relation: 'spot', target: at( lift.position ) } );
		const stairs = nearest( floor.stairs );
		if ( stairs ) spots.push( { place: { kind: 'spot', id: `stairs:${stairs.id}` }, name: this.lines.say( 'name-stairs' ), relation: 'spot', target: at( stairs.position ) } );
		const kinds = new Map();
		for ( const room of floor.rooms ) if ( ! room.unit && ! UNSHOWN.has( room.kind ) && ! kinds.has( room.kind ) ) kinds.set( room.kind, room );
		for ( const room of kinds.values() ) spots.push( { place: { kind: 'spot', id: `room:${room.id}` }, name: this.lines.say( 'name-room', { word: room.kind.replace( /_/g, ' ' ) } ), relation: 'spot', target: at( room.position ) } );
		for ( const other of plan.floors ) {

			if ( other.index === floor.index ) continue;
			const landing = other.lifts[ 0 ] ?? other.stairs[ 0 ];
			if ( landing ) spots.push( { place: { kind: 'spot', id: `floor:${other.index}` }, name: this.lines.say( 'name-floor', { floor: floorWord( other.index ) } ), relation: 'spot', target: { position: landing.position, parcelId: here.parcelId, floor: other.index } } );

		}
		return spots.map( ( entry ) => ( { ...entry, distance: flat( from, entry.target.position ) } ) );

	}

	/**
	 * The dwellings and private rooms the player's line names by number, in
	 * the building the person stands in, their home's and their work's, each
	 * by its address and led to the public side of its entry door. The
	 * person's own home is their home place already.
	 */
	#units( npc, from, here, line ) {

		if ( ! this.addresses || ! line ) return [];
		const parcels = [ ...new Set( [ here?.parcelId, npc.home?.parcelId, npc.job?.parcelId ].filter( Boolean ) ) ];
		const own = npc.home?.apartment ? `home:${npc.home.parcelId}/${npc.home.apartment.id}` : null;
		return this.addresses.find( line, parcels ).filter( ( unit ) => unit.scope !== own && unit.doors?.length ).map( ( unit ) => {

			const door = unit.doors[ 0 ];
			return {
				place: { kind: 'spot', id: `unit:${unit.id}` }, name: unit.address, relation: 'spot',
				target: { position: [ ...door.front ], parcelId: unit.parcelId, floor: unit.floor, door: [ ...door.at ], scope: unit.scope },
				distance: flat( from, door.front )
			};

		} );

	}

	/** The nearest point of a street's pavement to the person, on the walk graph, and how far off it is. */
	#onStreet( street, from ) {

		let best = null;
		for ( const edge of this.atlas.streets?.edges ?? [] ) {

			if ( ! street.edgeIds.includes( edge.id ) ) continue;
			for ( let index = 1; index < edge.path.length; index ++ ) {

				const point = closest( edge.path[ index - 1 ], edge.path[ index ], [ from[ 0 ], from[ 2 ] ] );
				const distance = Math.hypot( point[ 0 ] - from[ 0 ], point[ 1 ] - from[ 2 ] );
				if ( ! best || distance < best.distance ) best = { point, distance };

			}

		}
		if ( ! best ) return null;
		const pavement = this.routes.project?.( [ best.point[ 0 ], from[ 1 ], best.point[ 1 ] ] );
		return { position: pavement?.point ? [ ...pavement.point ] : [ best.point[ 0 ], from[ 1 ], best.point[ 1 ] ], distance: best.distance };

	}

	/** The corridor side of the numbered door of a person's own apartment, from the building's plan, or null. */
	#apartmentDoor( npc ) {

		const apartment = npc.home?.apartment;
		const plan = apartment ? this.inside?.plan?.( npc.home.parcelId ) ?? null : null;
		const door = plan?.apartments.find( ( entry ) => entry.floor === apartment.floor && ( apartment.number === undefined || entry.number === apartment.number ) );
		return door ? {
			position: [ ...door.front ], parcelId: npc.home.parcelId, floor: apartment.floor,
			door: [ ...door.door ], scope: `home:${npc.home.parcelId}/${apartment.id}`
		} : null;

	}

}

/** "ground", "first", "21st": a floor by its index. */
function floorWord( index ) {

	const words = [ 'ground', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth' ];
	if ( index < words.length ) return words[ index ];
	const end = index % 100 >= 11 && index % 100 <= 13 ? 'th' : [ 'th', 'st', 'nd', 'rd' ][ index % 10 ] ?? 'th';
	return `${index}${end}`;

}

/** The point of segment ab nearest p, in the plane. */
function closest( a, b, p ) {

	const dx = b[ 0 ] - a[ 0 ];
	const dz = b[ 1 ] - a[ 1 ];
	const span = dx * dx + dz * dz;
	const t = span > 0 ? Math.max( 0, Math.min( 1, ( ( p[ 0 ] - a[ 0 ] ) * dx + ( p[ 1 ] - a[ 1 ] ) * dz ) / span ) ) : 0;
	return [ a[ 0 ] + dx * t, a[ 1 ] + dz * t ];

}

/** The place a leader walks to for a quest place: a parcel, or a station or stop as its stop. */
function leadPlace( place ) {

	if ( place?.kind === 'parcel' ) return { kind: 'parcel', id: place.id };
	if ( place?.kind === 'station' || place?.kind === 'stop' ) return { kind: 'stop', id: place.id };
	return null;

}

/** Whether the player already stands in a place: its parcel, or its stop or station. */
export function standsIn( playerPlaces, place ) {

	return playerPlaces.some( ( here ) => here.id === place.id &&
		( place.kind === 'parcel' ? here.kind === 'parcel' : here.kind === 'stop' || here.kind === 'station' ) );

}

function keyOf( place ) {

	return `${place.kind}:${place.id}`;

}

/** The compass point `to` lies toward from `from`. */
function bearing( from, to ) {

	const turns = Math.atan2( to[ 0 ] - from[ 0 ], from[ 2 ] - to[ 2 ] ) / ( 2 * Math.PI );
	return COMPASS[ ( Math.round( turns * COMPASS.length ) + COMPASS.length ) % COMPASS.length ];

}

function flat( a, b ) {

	return Math.hypot( b[ 0 ] - a[ 0 ], b[ 2 ] - a[ 2 ] );

}
