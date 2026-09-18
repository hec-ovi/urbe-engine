import { fnv1a } from '../hash.js';

/**
 * Which family a parcel wears. A stable hash of the atlas seed and the parcel
 * id picks one of the families whose fits accept the lot and the floor count,
 * so a world rebuilt from the same blueprint dresses every street the same way,
 * and two parcels on the same lot still differ.
 *
 * @param candidates fitting family ids
 * @returns the chosen id, or null when nothing fits
 */
export function chooseFamily( candidates, worldSeed, parcelId ) {

	if ( ! candidates.length ) return null;

	const ordered = [ ...candidates ].sort();

	return ordered[ fnv1a( `${worldSeed}:kit:${parcelId}` ) % ordered.length ];

}
