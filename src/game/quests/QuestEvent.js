/**
 * The exact quests runtime event that completes one step's target, for the
 * cast `actorIds` it names in role order (castIds): the completion table of
 * the quests flow contract. An authored talk completes through its dialogue
 * choice instead; `talkedTo` is the legacy talk's.
 */
export function completionEvent( target, actorIds ) {

	switch ( target.kind ) {

		case 'goto': return { kind: 'arrivedAt', ...placeIdentity( target.place ) };
		case 'observe': return { kind: 'observed', districtId: target.districtId };
		case 'talk': return { kind: 'talkedTo', npcId: actorIds[ 0 ] };
		case 'listen': return { kind: 'overheard', npcIds: [ ...actorIds ] };
		case 'pickup': return { kind: 'pickedUp', itemId: target.itemId };
		case 'deliver': return { kind: 'delivered', itemId: target.itemId, ...placeIdentity( target.place ) };
		case 'steal': return { kind: 'stole', itemId: target.itemId };
		case 'assassinate': return { kind: 'killed', npcId: actorIds[ 0 ] };
		case 'work': return { kind: 'workedShift', parcelId: target.atParcelId };
		case 'investigation': return {
			kind: 'investigated', sceneId: target.sceneId, evidenceId: target.evidenceId, place: placeIdentity( target.place )
		};
		case 'rescue': return {
			kind: 'released', npcId: actorIds[ 0 ], releaseTargetId: target.releaseTargetId, place: target.place
		};
		case 'escort': return {
			kind: 'escorted', npcId: actorIds[ 0 ], routeId: target.routeId, mode: target.mode, from: target.from, to: target.to
		};
		case 'access': return {
			kind: 'accessed', accessPointId: target.accessPointId, credentialItemId: target.credentialItemId, place: target.place
		};
		case 'hacking': return { kind: 'hacked', targetId: target.targetId, place: target.place };
		case 'sabotage': return { kind: 'sabotaged', targetId: target.targetId, place: target.place };
		case 'transportation': return {
			kind: 'transported', journeyId: target.journeyId, mode: target.mode, from: target.from, to: target.to,
			passengerNpcIds: [ ...actorIds ], cargoItemIds: [ ...target.cargoItemIds ]
		};

	}
	throw new Error( `unsupported quest step ${target.kind}` );

}

/** An authored place without its name: the identity an event repeats. */
function placeIdentity( place ) {

	const key = [ 'parcelId', 'districtId', 'stationId', 'stopId' ].find( ( name ) => name in place );
	return { [ key ]: place[ key ] };

}
