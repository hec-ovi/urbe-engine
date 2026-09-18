// What one kit building ships as, named apart from the assembler so a reader
// of the out dir needs nothing of the producer.

/** Where this parcel stands and which plan it stands from. */
export const placementsFile = ( parcelId ) => `${parcelId}.placements.json`;
/** The same blueprint a generated shell publishes. */
export const blueprintFile = ( parcelId ) => `${parcelId}.blueprint.json`;
/** The generated path's own files, which a parcel standing from pieces never has. */
export const generatedFiles = ( parcelId ) => [ `${parcelId}.glb`, `${parcelId}.request.json` ];
/** The city's plans, beside the kit both the plans and the game name pieces from. */
export const PLANS_FOLDER = 'kit/plans';
/** One plan: every piece of one building, at the origin with face 0 along +X. */
export const planFile = ( planId ) => `${planId}.json`;
/** Where a parcel's record points the game, from the world root. */
export const planPath = ( planId ) => `${PLANS_FOLDER}/${planFile( planId )}`;
