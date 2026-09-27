/** How near a conversation something happened for the person in it to have seen it or heard of it, in metres. */
const NEAR = 80;
/** How long a car hitting someone stays news, in world minutes. */
const NEWS = 120;
/** The most events one conversation carries, the newest. */
const MOST = 8;
/** The most impacts kept, the newest. */
const KEPT = 32;

/**
 * What happened around a conversation, for the talk request's `events`: the
 * people cars hit, noted as each fall is taken, and the quest scenes standing
 * near it. Where each happened is the building whose street access is
 * nearest, and what is said of it is the dialogue layers' to word.
 */
export class RecentEvents {

	#struck = [];

	/** @param parcels the Atlas parcels, whose access points name where something happened */
	constructor( parcels ) {

		this.doors = parcels.map( ( parcel ) => ( { parcelId: parcel.id, x: parcel.access.point[ 0 ], z: parcel.access.point[ 1 ] } ) );

	}

	/**
	 * A car hit the crowd person `personId`, whom the simulation calls `npcId`
	 * when it names them, at `point` ({ x, z }) at minute `atMin`.
	 * @param hard the car was fast
	 */
	struck( { personId, npcId = null, point, hard = false, atMin } ) {

		const door = nearest( this.doors, point );
		if ( ! door ) return;
		this.#struck = [ ...this.#struck, { personId, npcId, x: point.x, z: point.z, parcelId: door.parcelId, hard, atMin } ].slice( - KEPT );

	}

	/**
	 * What a person talking at `position` at minute `timeMin` knows happened
	 * around them, newest first, at most MOST: the cars that hit someone
	 * within NEAR metres in the last NEWS minutes, and the quest scenes
	 * standing in the street within NEAR metres or in the building the talk
	 * stands in. A scene at the place the person has led the player to is
	 * left to that place's notes.
	 * @param npcId the person talked to, told when the car hit them
	 * @param down whether the crowd person `personId` still lies where they fell
	 * @param scenes SceneryDirector.stagedPlaces()
	 * @param parcelId the building the talk stands in, or null
	 * @param guided the parcel the person has led the player to, or null
	 */
	around( { position, timeMin, npcId = null, down = () => false, scenes = [], parcelId = null, guided = null } ) {

		const metres = ( at ) => Math.round( Math.hypot( at.x - position.x, at.z - position.z ) );
		const struck = this.#struck
			.filter( ( event ) => timeMin - event.atMin <= NEWS && metres( event ) <= NEAR )
			.map( ( event ) => ( {
				kind: 'struck', atMin: event.atMin, parcelId: event.parcelId, metres: metres( event ),
				...( event.hard ? { hard: true } : {} ),
				...( npcId && event.npcId === npcId ? { self: true } : down( event.personId ) ? { down: true } : {} )
			} ) );
		const staged = scenes
			.filter( ( { place, frame, notes } ) => notes.length && place.parcelId !== guided &&
				( frame.kind === 'street' ? metres( frame.origin ) <= NEAR : place.parcelId === parcelId ) )
			.map( ( { place, frame, notes, stagedAtMin } ) => ( {
				kind: 'scene', atMin: stagedAtMin, parcelId: place.parcelId, metres: metres( frame.origin ), notes
			} ) );
		return [ ...struck, ...staged ].sort( ( a, b ) => b.atMin - a.atMin ).slice( 0, MOST );

	}

}

function nearest( doors, point ) {

	let best = null, far = Infinity;
	for ( const door of doors ) {

		const distance = Math.hypot( door.x - point.x, door.z - point.z );
		if ( distance < far ) { best = door; far = distance; }

	}
	return best;

}
