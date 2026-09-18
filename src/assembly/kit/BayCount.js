import { BAY } from './Families.js';

/** Atlas publishes lot metres on a millimetre grid, so an edge snaps to its bay count. */
const TOLERANCE = 0.001;

/**
 * Bays along one lot edge, or null when the edge is not a whole number of them.
 * A plan is named after its bay counts, so two lots of the same size stand the
 * same building and a lot off the module keeps the generator.
 */
export function bayCount( metres ) {

	const bays = Math.round( metres / BAY );

	return Math.abs( metres - bays * BAY ) <= TOLERANCE && bays >= 2 ? bays : null;

}

/** Bays across and deep, or null when either edge is off the module. */
export function lotBays( width, depth ) {

	const across = bayCount( width );
	const deep = bayCount( depth );

	return across && deep ? { across, deep } : null;

}
