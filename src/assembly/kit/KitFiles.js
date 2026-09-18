// What one kit building ships as, named apart from the assembler so a reader
// of the out dir needs nothing of the producer.

/** The placement table: the pieces this building is made of and where they stand. */
export const placementsFile = ( parcelId ) => `${parcelId}.placements.json`;
/** The same blueprint a generated shell publishes. */
export const blueprintFile = ( parcelId ) => `${parcelId}.blueprint.json`;
/** The generated path's own files, which a parcel standing from pieces never has. */
export const generatedFiles = ( parcelId ) => [ `${parcelId}.glb`, `${parcelId}.request.json` ];
