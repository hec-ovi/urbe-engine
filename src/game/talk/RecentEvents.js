/** How near a conversation something happened for the person in it to have seen it or heard of it, in metres. */
const NEAR = 30;
/** How near a staged story scene in the street is still in sight, in metres. */
const SCENE_NEAR = 80;
/** How near a car hitting someone a person standing saw it, in metres. */
const WITNESS = 60;
/** How long a car hitting someone stays news, in world minutes. */
const NEWS = 30;
/** The most events one conversation carries: the newest impact and the newest scene, no list of small things. */
const MOST = 2;
/** The most impacts kept, the newest. */
const KEPT = 32;

/**
 * What happened around a conversation, for the talk request's `events`: the
 * people cars hit, noted as each fall is taken with who stood near enough to
 * see it, and the quest scenes standing near it. Where each happened is the
 * building whose street access is nearest, and what is said of it is the
 * dialogue layers' to word.
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
	 * @param people the crowd bodies ({ npcId, position, fallen }): the named
	 *        ones on their feet within NEAR metres saw it
	 */
	struck( { personId, npcId = null, point, hard = false, atMin, people = [] } ) {

		const door = nearest( this.doors, point );
		if ( ! door ) return;
		const witnesses = [];
		for ( const person of people ) {

			if ( person.npcId && ! person.fallen && Math.hypot( person.position.x - point.x, person.position.z - point.z ) <= WITNESS ) witnesses.push( person.npcId );

		}
		this.#struck = [ ...this.#struck, { personId, npcId, x: point.x, z: point.z, parcelId: door.parcelId, hard, atMin, witnesses } ].slice( - KEPT );

	}

	/**
	 * What a person talking at `position` at minute `timeMin` knows happened
	 * around them that would still be on their mind, newest first: the newest
	 * car that hit someone in the last NEWS minutes, when it hit this person,
	 * they saw it (a leader who walked the player on since), or it hit hard
	 * or left somebody lying within NEAR metres; and the newest quest scene
	 * standing in the street within SCENE_NEAR metres or in the building the
	 * talk stands in. A scene at the place the person has
	 * led the player to is left to that place's notes.
	 * @param npcId the person talked to, told when the car hit them
	 * @param down whether the crowd person `personId` still lies where they fell
	 * @param scenes SceneryDirector.stagedPlaces()
	 * @param parcelId the building the talk stands in, or null
	 * @param guided the parcel the person has led the player to, or null
	 */
	around( { position, timeMin, npcId = null, down = () => false, scenes = [], parcelId = null, guided = null } ) {

		const metres = ( at ) => Math.round( Math.hypot( at.x - position.x, at.z - position.z ) );
		const self = ( event ) => Boolean( npcId ) && event.npcId === npcId;
		// Only what would stay on anyone's mind: the person was hit, saw it, or it was hard or left somebody lying there close by.
		const struck = this.#struck
			.filter( ( event ) => timeMin - event.atMin <= NEWS &&
				( self( event ) || event.witnesses.includes( npcId ) || ( metres( event ) <= NEAR && ( event.hard || down( event.personId ) ) ) ) )
			.sort( ( a, b ) => b.atMin - a.atMin ).slice( 0, 1 )
			.map( ( event ) => ( {
				kind: 'struck', atMin: event.atMin, parcelId: event.parcelId, metres: metres( event ),
				...( event.hard ? { hard: true } : {} ),
				...( self( event ) ? { self: true } : down( event.personId ) ? { down: true } : {} )
			} ) );
		const staged = scenes
			.filter( ( { place, frame, notes } ) => notes.length && place.parcelId !== guided &&
				( frame.kind === 'street' ? metres( frame.origin ) <= SCENE_NEAR : place.parcelId === parcelId ) )
			.map( ( { place, frame, notes, stagedAtMin } ) => ( {
				kind: 'scene', atMin: stagedAtMin, parcelId: place.parcelId, metres: metres( frame.origin ), notes
			} ) ).sort( ( a, b ) => b.atMin - a.atMin ).slice( 0, 1 );
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
