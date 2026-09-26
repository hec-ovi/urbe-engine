import { describe, expect, it } from 'vitest';
import standard from './notes.md?raw';
import { SceneNotes } from './SceneNotes.js';
import { crimeScene, drive } from './scenery.test-fixtures.js';

describe( 'scene notes', () => {

	it( 'say the purpose, then each element the scene still shows, in the order the spec lists them', () => {

		const medic = { actorId: 'medic', role: 'officer', identity: { kind: 'anonymous', gender: 'female', appearanceSeed: 9 }, pose: 'kneel-examine', placement: { zone: 'incident' } };
		const spec = crimeScene( { purpose: 'aftermath', actors: [ ...crimeScene().actors, medic ] } );
		const assembly = { entities: [ { entityId: 'courier' }, { entityId: 'medic' }, { entityId: 'drive', missionAsset: drive } ] };

		expect( SceneNotes.standard().of( spec, assembly, new Set( [ 'pool' ] ) ) ).toEqual( [
			'Something happened here not long ago.',
			'A body lies on the ground.',
			'Someone kneels there, looking something over closely.',
			'A data drive lies there.'
		] );

	} );

	it( 'refuse a document that lacks a key or names one no scene shows', () => {

		expect( () => new SceneNotes( standard.replace( /## pose-grieving\n\n.*\n/, '' ) ) )
			.toThrowError( expect.objectContaining( { code: 'E_SCENERY_INPUT', message: 'scene notes lack pose-grieving' } ) );
		expect( () => new SceneNotes( `${standard}\n## pose-dancing\n\nSomeone dances.\n` ) )
			.toThrowError( expect.objectContaining( { code: 'E_SCENERY_INPUT', message: 'scene notes name unknown pose-dancing' } ) );

	} );

} );
