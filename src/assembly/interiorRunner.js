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
