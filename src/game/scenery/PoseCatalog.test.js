import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import capabilities from './capabilities.json' with { type: 'json' };
import poses from './poses.json' with { type: 'json' };
import values from './schema/values.schema.json' with { type: 'json' };
import { POSE_IDS, assertPoseClips } from './PoseCatalog.js';
import { SceneryBoundary } from './SceneryBoundary.js';

const LIBRARY = '/work/models/universal-animation-library-pro/UAL1.glb';

describe( 'pose catalog and declared capabilities', () => {

	it( 'declares exactly the poses, places and props the scene contract names, corpses only in Death01 and Death02', () => {

		new SceneryBoundary().input( 'capabilities', capabilities );
		expect( POSE_IDS ).toEqual( values.$defs.poseId.enum );
		expect( capabilities.poses ).toEqual( POSE_IDS );
		const corpses = POSE_IDS.filter( ( id ) => poses[ id ].corpse );
		expect( corpses ).toEqual( values.$defs.corpsePoseId.enum );
		expect( corpses.map( ( id ) => poses[ id ].clip ) ).toEqual( [ 'Death01', 'Death02' ] );
		expect( capabilities.placeKinds ).toEqual( values.$defs.place.oneOf.flatMap( ( branch ) => branch.properties.kind.enum ?? [ branch.properties.kind.const ] ) );
		expect( capabilities.propKinds ).toEqual( values.$defs.prop.properties.kind.enum );

	} );

	it.skipIf( ! existsSync( LIBRARY ) )( 'finds every pose clip in the audited Pro library', () => {

		const glb = readFileSync( LIBRARY );
		const length = glb.readUInt32LE( 12 );
		const document = JSON.parse( glb.subarray( 20, 20 + length ).toString( 'utf8' ) );
		const animation = { animations: document.animations.map( ( clip ) => ( { name: clip.name } ) ) };
		expect( () => assertPoseClips( animation ) ).not.toThrow();

	} );

	it( 'refuses a library that lacks a pose clip', () => {

		expect( () => assertPoseClips( { animations: [ { name: 'Death01' } ] } ) )
			.toThrowError( expect.objectContaining( { code: 'E_SCENERY_ASSET', message: expect.stringMatching( /Death02, Crawl_Idle_Loop/ ) } ) );

	} );

} );
