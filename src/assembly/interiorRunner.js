/**
 * Black-box runner for the interior library (../interior/CONTRACT.md): imports
 * the sibling package by path and calls its public entries. The entry is
 * TypeScript, so this module must run under a TS-capable loader (tsx).
 */

import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

// The sibling checkout by default; URBE_INTERIOR_DIR names another checkout of
// the Interior box (a pinned worktree while its main tree is mid-edit).
export const INTERIOR_ENTRY = process.env.URBE_INTERIOR_DIR
	? new URL( 'src/index.ts', `file://${process.env.URBE_INTERIOR_DIR.replace( /\/?$/, '/' )}` ).href
	: new URL( '../../../interior/src/index.ts', import.meta.url ).href;

/** The expanded NPC support beside the building, for simulation and the runtime. */
export const NPC_FILE = 'npc.json';

/**
 * One furnished building on disk. Interior places its three reusable layouts
 * (ground, middle, crown) and writes them itself; `expandBuilding` turns them
 * into the building's own per-floor identities, elevations and connectors,
 * which is what `npc.json` carries. Geometry stays in the shared module set the
 * city publishes once, so a building ships as JSON alone. The folder is written
 * beside `interiorDir` and renamed over it whole: a failed build leaves the
 * folder that stood, and a world cloned by hard links never sees the write.
 *
 * @returns the BuildingManifest interior wrote to `building.json`
 */
export async function runInterior( request, interiorDir ) {

	const { generate, writePlacements, expandBuilding } = await import( INTERIOR_ENTRY );
	const result = await generate( request );
	mkdirSync( dirname( interiorDir ), { recursive: true } );
	const staged = mkdtempSync( join( dirname( interiorDir ), `.${basename( interiorDir )}-` ) );

	try {

		await writePlacements( result, staged );
		const { npc } = expandBuilding( result );
		writeFileSync( join( staged, NPC_FILE ), JSON.stringify( npc ) + '\n' );
		rmSync( interiorDir, { recursive: true, force: true } );
		renameSync( staged, interiorDir );

	} finally { rmSync( staged, { recursive: true, force: true } ); }

	return result.building;

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
