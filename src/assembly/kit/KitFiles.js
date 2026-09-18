// What one kit building ships as, named apart from the assembler so a reader
// of the out dir needs nothing of the producer.

/** Where this parcel stands and which plan it stands from. */
export const placementsFile = ( parcelId ) => `${parcelId}.placements.json`;
/** What a generated shell publishes; a kit parcel reads its plan's instead. */
export const blueprintFile = ( parcelId ) => `${parcelId}.blueprint.json`;
/** The generated path's own files, which a parcel standing from a plan never has. */
export const generatedFiles = ( parcelId ) => [ `${parcelId}.glb`, `${parcelId}.request.json` ];
/** What the shared store calls a set of plan shells. */
export const PLANS_KIND = 'plans';
/** One plan's shell, at the origin with face 0 along +X. */
export const planGlbFile = ( planId ) => `${planId}.glb`;
/** That same building's blueprint, in the same frame, for every parcel of it. */
export const planBlueprintFile = ( planId ) => `${planId}.blueprint.json`;
/** The index of the plans one world stands on, which its manifest binds. */
export const PLAN_INDEX_FILE = 'kit.json';
