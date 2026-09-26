import { describe, expect, it } from 'vitest';
import interior from '../investigation/fixtures/interior-incident.json';
import { SceneryCompiler } from './SceneryCompiler.js';
import { assets, courier, crimeScene, drive, frame } from './scenery.test-fixtures.js';
import { worldToLocal } from './StagingAssembler.js';

describe( 'scenery compiler', () => {

	it( 'lays out the crime scene in its frame, apart and clear of the doors, the same every time', () => {

		const compiler = new SceneryCompiler( { missionAssets: assets } );
		const { request, assembly } = compiler.compile( crimeScene(), frame, courier );
		expect( JSON.stringify( compiler.compile( crimeScene(), structuredClone( frame ), structuredClone( courier ) ) ) ).toBe( JSON.stringify( { request, assembly } ) );

		const body = assembly.entities.find( ( entity ) => entity.entityId === 'courier' );
		expect( body ).toMatchObject( {
			role: 'body', poseId: 'death-a', sourceMaterialPolicy: 'dressed-appearance', blocksMovement: true,
			appearance: { gender: 'female', appearanceSeed: 77 },
			asset: { uri: '/models/universal-base-characters-source/Regular_Female_FullBody.gltf' },
			dimensions: { width: 1.1, height: 0.35, depth: 2.2 }
		} );
		expect( body ).not.toHaveProperty( 'materials' );
		expect( assembly.actors ).toEqual( [ { actorId: 'courier', npcId: 'npc-v', gender: 'female', appearanceSeed: 77, poseId: 'death-a', clip: 'Death01', at: 1 } ] );
		expect( assembly.entities.find( ( entity ) => entity.entityId === 'drive' ) ).toMatchObject( { role: 'prop', portable: true, missionAsset: { assetId: drive.assetId } } );

		const location = interior.location;
		const rects = assembly.entities.map( ( entity ) => localRect( entity, location ) );
		for ( const rect of rects ) {

			expect( Math.abs( rect.center.x ) + rect.width / 2 ).toBeLessThanOrEqual( location.width / 2 );
			expect( Math.abs( rect.center.z ) + rect.depth / 2 ).toBeLessThanOrEqual( location.depth / 2 );
			for ( const entry of location.entries ) expect( distanceToRect( entry.position, rect ) ).toBeGreaterThanOrEqual( entry.clearanceRadius - 1e-6 );

		}
		expect( gap( rects[ 0 ], rects[ 1 ] ) ).toBeGreaterThanOrEqual( 0.12 - 1e-6 );

		const [ pool ] = assembly.decals;
		expect( pool ).toMatchObject( {
			entityId: 'pool', surfaceId: 'floor-main', width: 1.45, height: 0.72, offsetMeters: 0.006,
			material: { slot: 'surface', key: 'cyberpunk/incident-blood/mid', variantId: 'directional-pool' }
		} );
		expect( pool.transform.position.y ).toBeCloseTo( location.origin.y + 0.006, 6 );

		expect( request.bodies[ 0 ] ).toMatchObject( { entityId: 'courier', placement: { zone: 'center' } } );
		expect( assembly.frame ).toEqual( { kind: 'interior', origin: location.origin, yawRadians: 0, width: 8, depth: 7 } );

	} );

	it( 'places a centred element nearest the story slot it stands at', () => {

		const compiler = new SceneryCompiler( { missionAssets: assets } );
		const anchored = compiler.compile( crimeScene( { props: [] } ), { ...frame, anchor: { x: 2.4, z: 1.6 } }, courier );
		const body = localRect( anchored.assembly.entities[ 0 ], interior.location );
		expect( Math.hypot( body.center.x - 2.4, body.center.z - 1.6 ) ).toBeLessThan( 1 );
		expect( anchored.request.bodies[ 0 ].placement.point ).toEqual( { x: 2.4, z: 1.6 } );

	} );

	it( 'names an element that cannot stand, an asset the bundle lacks and a person it has no identity for', () => {

		const compiler = new SceneryCompiler( { missionAssets: assets } );
		const cramped = structuredClone( frame );
		cramped.location = {
			...cramped.location, width: 3, depth: 3, receivingSurfaces: [],
			entries: [ { entryId: 'door', position: { x: 0, z: -1.5 }, clearanceRadius: 1.1 } ],
			blockedZones: [ { blockerId: 'bed', center: { x: 0, z: 0.6 }, width: 3, depth: 1.6 } ]
		};
		expect( () => compiler.compile( crimeScene( { props: [] } ), cramped, courier ) ).toThrowError( expect.objectContaining( { code: 'E_SCENERY_NO_FIT' } ) );
		expect( () => compiler.compile( crimeScene( { props: [ { propId: 'case', kind: 'mission-asset', assetId: 'asset.gone' } ] } ), frame, courier ) )
			.toThrowError( expect.objectContaining( { code: 'E_SCENERY_BINDING', message: expect.stringMatching( /asset.gone/ ) } ) );
		expect( () => compiler.compile( crimeScene( { props: [ { propId: 'pool', kind: 'blood-pool', nearPropId: 'ghost' } ] } ), frame, courier ) )
			.toThrowError( expect.objectContaining( { code: 'E_SCENERY_BINDING' } ) );
		expect( () => compiler.compile( crimeScene( { actors: [], props: [ { propId: 'pool', kind: 'blood-pool' } ] } ), cramped, [] ) )
			.toThrowError( expect.objectContaining( { code: 'E_SCENERY_NO_FIT', message: expect.stringMatching( /no floor for pool/ ) } ) );
		expect( () => compiler.compile( crimeScene(), frame, [] ) ).toThrowError( expect.objectContaining( { code: 'E_SCENERY_IDENTITY' } ) );

	} );

} );

function localRect( entity, location ) {

	const center = worldToLocal( location, entity.footprint.center );
	const quarter = Math.round( ( entity.footprint.yawRadians - location.yawRadians ) / ( Math.PI / 2 ) );
	const swap = Math.abs( quarter ) % 2 === 1;
	return { center, width: swap ? entity.footprint.depth : entity.footprint.width, depth: swap ? entity.footprint.width : entity.footprint.depth };

}

function distanceToRect( point, rect ) {

	const x = Math.max( rect.center.x - rect.width / 2, Math.min( rect.center.x + rect.width / 2, point.x ) );
	const z = Math.max( rect.center.z - rect.depth / 2, Math.min( rect.center.z + rect.depth / 2, point.z ) );
	return Math.hypot( point.x - x, point.z - z );

}

function gap( left, right ) {

	return Math.max(
		Math.abs( left.center.x - right.center.x ) - ( left.width + right.width ) / 2,
		Math.abs( left.center.z - right.center.z ) - ( left.depth + right.depth ) / 2
	);

}
