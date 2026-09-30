import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { RigIdle } from './RigIdle.js';
import { idleStyle } from './IdleVariety.js';
import { CROWD_CLIP_NAMES } from './CharacterCatalog.js';
import { animation, rig } from './HeroCharacter.test-fixtures.js';

/** Each crowd clip turns the root to an angle of its own, so the pose says which clip plays. */
const turns = Object.fromEntries( CROWD_CLIP_NAMES.map( ( name, index ) => [ name, [ index * 0.1, index * 0.1 ] ] ) );
/** The library's clips stand on the rig as they are: its transfer is the identity. */
const motions = { clip: ( clip ) => clip };

describe( 'a rig at rest', () => {

	it( 'rests a staged guard as a guard on duty does, fidgets included, blending from clip to clip', () => {

		const root = rig();
		const idle = new RigIdle( { root, animation: animation( turns ), motions, rest: { type: 'security_guard', activity: 'working', appearanceSeed: 77 } } );
		const bone = root.getObjectByName( 'root' );
		const played = new Set();
		const angles = new Set();
		for ( let t = 0; t < 90; t += 1 / 30 ) {

			idle.update( 1 / 30 );
			played.add( idle.playing );
			angles.add( new THREE.Euler().setFromQuaternion( bone.quaternion ).x.toFixed( 2 ) );

		}
		const style = idleStyle( 'guard', 77 );
		expect( played ).toContain( CROWD_CLIP_NAMES[ style.base ] );
		expect( played.size ).toBeGreaterThan( 1 );
		for ( const name of played ) expect( [ style.base, ...style.fidgets.map( ( [ clip ] ) => clip ) ].map( ( clip ) => CROWD_CLIP_NAMES[ clip ] ) ).toContain( name );
		// Blending shows poses between the clips' own.
		expect( angles.size ).toBeGreaterThan( played.size );
		idle.dispose();

	} );

	it( 'keeps a held loop playing from a phase of the rig\'s own', () => {

		const root = rig();
		const clips = animation( { Crouch_Idle_Loop: [ 0, 1 ] } );
		const first = new RigIdle( { root, animation: clips, motions, rest: { loop: 'Crouch_Idle_Loop', appearanceSeed: 5 } } );
		const second = new RigIdle( { root: rig(), animation: clips, motions, rest: { loop: 'Crouch_Idle_Loop', appearanceSeed: 6 } } );
		const bone = root.getObjectByName( 'root' );
		first.update( 0 );
		const start = bone.quaternion.clone();
		first.update( 0.3 );
		expect( bone.quaternion.angleTo( start ) ).toBeGreaterThan( 0.1 );
		expect( first.playing ).toBe( 'Crouch_Idle_Loop' );
		expect( first.action.time ).not.toBeCloseTo( second.action.time, 3 );

	} );

} );
