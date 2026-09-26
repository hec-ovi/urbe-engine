import { VENUES } from '../../../../quests/dist/runtime.js';
import { COMPASS } from './CompanionLines.js';

/** Farthest a person leads the player, along the pavement, in metres. */
const MAX_LEAD = 800;
/** A place nearer than this along the pavement is where the person already stands. */
const MIN_LEAD = 10;
/** Most places one person offers to show. */
const MAX_PLACES = 4;
/** Open quest places first, then staged scenes, then the person's own life. */
const RANK = { quest: 0, scene: 1, work: 2, home: 3, haunt: 4 };

/**
 * Where one person could take the player: the places of open quest steps and
 * staged scenes, their workplace, home and haunts, each one they can walk to
 * within MAX_LEAD, in a fixed order.
 */
export class CompanionPlaces {

	/**
	 * @param atlas the city plan: parcels with their type and optional name, transit stops and stations
	 * @param places continuity places `{ kind, id, position }`: where a leader stops at each place
	 * @param routes the WalkRoutes the walk there is measured on
	 * @param lines CompanionLines, which name what has no name of its own
	 */
	constructor( { atlas, places, routes, lines } ) {

		this.routes = routes;
		this.lines = lines;
		this.positions = new Map( places.map( ( place ) => [ keyOf( place ), place.position ] ) );
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
	destinations( { npc, from, playerPlaces, quests = [], scenes = [] } ) {

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
		if ( npc.job ) add( { kind: 'parcel', id: npc.job.parcelId }, 'work' );
		if ( npc.transitJob?.place.kind === 'stop' ) add( { kind: 'stop', id: npc.transitJob.place.id }, 'work' );
		add( { kind: 'parcel', id: npc.home.parcelId }, 'home' );
		for ( const entry of npc.routine ) {

			if ( ( entry.activity === 'leisure' || entry.activity === 'shopping' ) && entry.place.kind === 'parcel' ) add( entry.place, 'haunt' );

		}

		const found = [];
		for ( const [ key, candidate ] of candidates ) {

			const position = this.positions.get( key );
			if ( ! position || standsIn( playerPlaces, candidate.place ) || flat( from, position ) > MAX_LEAD ) continue;
			const name = candidate.name ?? this.name( candidate.place );
			const route = name ? this.routes.route( from, position ) : null;
			if ( ! route || route.distanceMeters > MAX_LEAD || route.distanceMeters < MIN_LEAD ) continue;
			const distance = route.distanceMeters;
			found.push( { ...candidate, name, distance, point: bearing( from, position ), metres: Math.round( distance / 10 ) * 10 } );

		}
		found.sort( ( a, b ) => RANK[ a.relation ] - RANK[ b.relation ] || a.distance - b.distance || keyOf( a.place ).localeCompare( keyOf( b.place ) ) );
		const offered = [];
		const heard = new Set();
		for ( const entry of found ) {

			if ( offered.length === MAX_PLACES ) break;
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
