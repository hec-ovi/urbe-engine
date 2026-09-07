import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
	CHARACTER_MODELS, CROWD_MODELS, HAIRSTYLES, HAIRSTYLE_FILES, PLAYER_CLIP_NAMES,
	assertRigCompatibility, avatarFor, bodyFor
} from './CharacterCatalog.js';

describe( 'character catalog', () => {

	it( 'contains every Source full-body shape and every gameplay clip', () => {

		expect( CHARACTER_MODELS.map( ( entry ) => entry.id ) ).toEqual( [
			'regular-male', 'regular-female', 'teen-male',
			'teen-female', 'superhero-male', 'superhero-female'
		] );
		expect( new Set( Object.values( PLAYER_CLIP_NAMES ) ) ).toEqual( new Set( [
			'Idle_Loop', 'Walk_Loop', 'Sprint_Loop', 'Crouch_Idle_Loop',
			'Crouch_Fwd_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land'
		] ) );
		expect( CHARACTER_MODELS.every( ( entry ) => entry.hair.endsWith( '.gltf' ) ) ).toBe( true );
		expect( HAIRSTYLES.male.adult ).toHaveLength( 7 );
		expect( HAIRSTYLES.male.facial ).toHaveLength( 3 );
		expect( HAIRSTYLES.female.adult ).toHaveLength( 6 );
		expect( HAIRSTYLE_FILES ).toHaveLength( 32 );
		expect( new Set( HAIRSTYLE_FILES ) ).toHaveLength( 32 );

	} );

	it( 'keeps the crowd body and hairstyle when an NPC receives a full rig', () => {

		expect( CROWD_MODELS ).toHaveLength( 2 );
		expect( bodyFor( 'male', 9 ) ).toBe( 0 );
		expect( bodyFor( 'female', 8 ) ).toBe( 1 );
		expect( avatarFor( 'female', 4 ) ).toEqual( avatarFor( 'female', 4 ) );
		expect( avatarFor( 'female', 4 ).gender ).toBe( 'female' );
		for ( const gender of [ 'male', 'female' ] ) {

			const original = CROWD_MODELS[ bodyFor( gender, 4 ) ];
			expect( avatarFor( gender, 4 ) ).toEqual( { ...original, hairs: [ original.hair ] } );

		}

	} );

	it( 'fails closed when a model and animation skeleton differ', () => {

		const character = rootWith( [ 'root', 'pelvis', 'spine' ] );
		const animation = rootWith( [ 'root', 'pelvis', 'spine' ] );

		expect( assertRigCompatibility( character, animation ) ).toEqual( [ 'root', 'pelvis', 'spine' ] );
		expect( () => assertRigCompatibility( character, rootWith( [ 'root', 'pelvis' ] ) ) ).toThrow( /does not match/ );

	} );

} );

function rootWith( names ) {

	const root = new THREE.Group();
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [ 0, 0, 0 ], 3 ) );
	const mesh = new THREE.SkinnedMesh( geometry );
	mesh.skeleton = { bones: names.map( ( name ) => ( { name } ) ) };
	root.add( mesh );

	return root;

}
