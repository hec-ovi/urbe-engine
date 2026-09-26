/** Descriptor fields a save may leave out; each keeps its last saved value until a save sends it again. */
export const OPTIONAL_SAVE_FIELDS = Object.freeze( [
	'transitJourney', 'questTransit', 'npcState', 'investigations', 'scenery', 'dialogueMemory'
] );

/** The optional fields a save carries: the ones sent now, else the ones saved before. */
export function carriedFields( sent, saved ) {

	const fields = {};
	for ( const key of OPTIONAL_SAVE_FIELDS ) {

		if ( Object.hasOwn( sent, key ) ) fields[ key ] = sent[ key ];
		else if ( Object.hasOwn( saved, key ) ) fields[ key ] = saved[ key ];

	}
	return fields;

}
