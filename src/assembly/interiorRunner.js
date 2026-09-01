/**
 * Black-box runner for the interior library (../interior/CONTRACT.md):
 * imports the sibling package by path and calls generateInterior(request).
 * The entry is TypeScript, so this module must run under a TS-capable loader (tsx).
 */

const INTERIOR_ENTRY = new URL( '../../../interior/src/index.ts', import.meta.url ).href;

/** @returns InteriorResult: { glb: Uint8Array, floors: FloorInterior[], npc: NpcSupport } */
export async function runInterior( request ) {

	const { generateInterior } = await import( INTERIOR_ENTRY );

	return generateInterior( request );

}

/**
 * Pre-generation gate (footprint-shape driven, never floor-count driven):
 * whether the blueprint's floors fit interior's vertical core plus egress.
 * @returns { fits, bandLength, minCoreLength, maxElevators, crossDepthOk, frameAngleDeg }
 */
export async function runCoreFeasibility( blueprint ) {

	const { coreFeasibility } = await import( INTERIOR_ENTRY );

	return coreFeasibility( blueprint );

}
