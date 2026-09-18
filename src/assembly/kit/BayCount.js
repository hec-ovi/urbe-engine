/** Atlas publishes lot metres on a millimetre grid, so an edge snaps to its bay count. */
const TOLERANCE = 0.001;

/**
 * Bays along one lot edge, or null when the edge is not a whole number of them.
 *
 * An edge of 8N metres carries two 4 m corner arms and N-1 straight bays, so
 * each face places N pieces: the corner at its start and the bays after it.
 * N is the count Exterior's `baysAcross` returns and the count its family
 * `fits.bays` range is stated in.
 */
export function bayCount( metres, module ) {

	const bays = Math.round( metres / module.bay );

	return Math.abs( metres - bays * module.bay ) <= TOLERANCE && bays >= 2 ? bays : null;

}

/** Bays across and deep, or null when either edge is off the module. */
export function lotBays( width, depth, module ) {

	const across = bayCount( width, module );
	const deep = bayCount( depth, module );

	return across && deep ? { across, deep } : null;

}

/** Pieces one storey places: the corner and the straight bays of all four faces. */
export function piecesPerFloor( { across, deep } ) {

	return 2 * ( across + deep );

}
