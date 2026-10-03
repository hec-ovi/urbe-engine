/**
 * The story side of locked doors: Quests' `access` steps that stand at a
 * door by its address (`door: 'apartment 1407'`) and the quest items that
 * open one (`opens`), resolved against the game's AddressBook.
 */

/**
 * The `accessed` events the player getting into a dwelling or private room
 * completes: one per active access step whose door, in that building, is
 * the unit of `scope`. The questline still checks the credential the step
 * needs, so a step a card from free talk does not satisfy stays open.
 * @param entries the quest session's `[{ definition, runtime }]`
 * @param parcelId the building the player got into
 * @param scope the scope of the unit they stand in
 * @param unitOf `( parcelId, door ) => unit | null`, the unit a door address names
 * @returns `[{ questId, stepId, event }]`
 */
export function accessEvents( { entries = [], parcelId, scope, unitOf } ) {

	const events = [];
	for ( const { definition, runtime } of entries ) for ( const step of runtime.activeSteps() ) {

		const target = step.target;
		if ( target.kind !== 'access' || ! target.door || target.place?.parcelId !== parcelId ) continue;
		if ( unitOf( parcelId, target.door )?.scope !== scope ) continue;
		events.push( {
			questId: definition.id, stepId: step.stepId,
			event: { kind: 'accessed', accessPointId: target.accessPointId, credentialItemId: target.credentialItemId, place: { parcelId } }
		} );

	}
	return events;

}

/**
 * The quest items the player holds that open a door, with the scope of that
 * door: `[{ id, name, scope }]`, an item whose door the building does not
 * number left out.
 * @param held the quest inventory `[{ id, name }]`
 * @param opens Map of item id to its Quests `opens` `{ parcelId, door }`
 */
export function questCards( { held = [], opens, unitOf } ) {

	const cards = [];
	for ( const item of held ) {

		const door = opens?.get( item.id );
		const unit = door ? unitOf( door.parcelId, door.door ) : null;
		if ( unit ) cards.push( { id: item.id, name: item.name, scope: unit.scope } );

	}
	return cards;

}

/** The unit of a building a door address names: its label (`apartment 1407`, `archive 302`), else a number in it. */
export function doorUnit( book, parcelId, door ) {

	const words = String( door ?? '' ).trim().toLowerCase().replace( /\s+/g, ' ' );
	const units = book?.building( parcelId )?.units ?? [];
	return units.find( ( unit ) => unit.label.toLowerCase() === words ) ?? book?.find( words, [ parcelId ] )[ 0 ] ?? null;

}
