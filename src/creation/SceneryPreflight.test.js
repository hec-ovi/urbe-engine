import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandBuilding, generate, makePlacementFixture, writePlacements } from '../../../interior/src/index.ts';
import { crimeScene, drive } from '../game/scenery/scenery.test-fixtures.js';
import { SceneryPreflight } from './src/SceneryPreflight.js';

const THEMES = fileURLToPath( new URL( '../../../materials/themes', import.meta.url ) );

/** The drive the crime scene shows, requested as a quest item's asset is. */
const driveRequest = {
	contractVersion: '1.0', assetId: drive.assetId, purpose: 'The courier\'s drive', family: 'data-drive',
	dimensions: { width: 0.12, height: 0.025, depth: 0.075 },
	materials: [ { slot: 'surface', key: 'cyberpunk/metal/mid', variantId: 'paint' }, { slot: 'accent', key: 'cyberpunk/metal/mid', variantId: 'zinc' } ],
	requiredInteractions: [ 'inspect', 'take', 'use' ], clearance: { approachDepth: 0.8, sideMargin: 0.2, overhead: 0.1 }, seed: 7
};

describe( 'scenery preflight', () => {

	let world;

	beforeAll( async () => {

		// One furnished home, written as the assembler publishes an opened building.
		world = await mkdtemp( join( tmpdir(), 'urbe-preflight-' ) );
		const request = makePlacementFixture( { width: 24, depth: 32, floors: 3, type: 'residential', tier: 'high_rich', seed: 11 } );
		const building = await generate( request );
		await writePlacements( building, join( world, 'p47', 'interior' ) );
		await writeJson( join( world, 'p47', 'interior', 'npc.json' ), expandBuilding( building ).npc );
		await writeJson( join( world, 'p47', 'p47.blueprint.json' ), { ...request.blueprint, buildingId: 'p47' } );
		await writeJson( join( world, 'blueprint.json' ), { meta: { seed: 'preflight' }, parcels: [ { id: 'p47' } ] } );
		await writeJson( join( world, 'manifest.json' ), { parcels: [ 'p47' ], interiors: [ 'p47' ], sources: { p47: 'shell' } } );

	}, 60000 );

	afterAll( () => rm( world, { recursive: true, force: true } ) );

	it( 'stands a scene the opened building has room for and names the questline whose scene it cannot', async () => {

		const preflight = new SceneryPreflight( { themesDir: THEMES, theme: 'cyberpunk' } );
		// A home's flats are upstairs; its ground floor is a lobby.
		const standing = crimeScene( { place: { kind: 'room', parcelId: 'p47', floor: 1, roomKinds: [ 'living' ] } } );
		const nowhere = crimeScene( { sceneId: 'lobby-find', questId: 'quest-lobby' } );
		const closed = crimeScene( { sceneId: 'shop-find', questId: 'quest-shop', place: { kind: 'room', parcelId: 'p12', floor: 0, roomKinds: [ 'living' ] } } );

		const blocked = await preflight.check( world, { scenery: [ standing, nowhere, closed ], missionAssetRequests: [ driveRequest ] } );

		expect( [ ...blocked.keys() ] ).toEqual( [ 'quest-lobby', 'quest-shop' ] );
		expect( blocked.get( 'quest-lobby' ) ).toBe( 'scene lobby-find in p47: E_SCENERY_PLACE p47 floor 0 has no living room' );
		expect( blocked.get( 'quest-shop' ) ).toMatch( /p12 has no furnished interior/ );
		expect( await preflight.check( world, { scenery: [], missionAssetRequests: [] } ) ).toEqual( new Map() );

	} );

} );

async function writeJson( path, value ) {

	await mkdir( join( path, '..' ), { recursive: true } );
	await writeFile( path, JSON.stringify( value ) );

}
