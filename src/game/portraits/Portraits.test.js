import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { Portraits, frameFace } from './Portraits.js';

/** Stands in for Snapshots: keeps each stage, and resolves with what it staged. */
function fakeSnapshots() {

	const stages = [];
	return {
		stages,
		take: vi.fn( ( stage ) => {

			stages.push( stage );
			return Promise.resolve().then( stage ).then( ( staged ) => {

				if ( ! staged ) return null;
				const picture = `blob:${staged.scene.children.length}`;
				staged.done?.();
				return picture;

			} );

		} )
	};

}

/** A dressed person: a root whose Head bone stands at 1.6 m. */
function fakePoser() {

	const released = [];
	return {
		released,
		pose: vi.fn( async ( recipe, clip, at ) => {

			const root = new THREE.Group();
			const head = new THREE.Bone();
			head.name = 'Head';
			head.position.set( 0, 1.6, 0 );
			root.add( head );
			root.userData = { recipe, clip, at };
			return root;

		} ),
		release: ( root ) => released.push( root )
	};

}

describe( 'Portraits', () => {

	it( 'pictures a person in their own recipe once, head and shoulders from the front left, and gives the rig back', async () => {

		const snapshots = fakeSnapshots();
		const poser = fakePoser();
		const sim = { getNPC: vi.fn( ( npcId ) => {

			if ( npcId === 'gone' ) throw new Error( 'NPC gone is not instanced' );
			return { npcId, gender: 'female', appearanceSeed: 12345, name: { given: 'Mira', family: 'Chen' } };

		} ) };
		const portraits = new Portraits( { snapshots, poser, sim } );

		const first = await portraits.portrait( { npcId: 'a2' } );
		expect( first ).toBe( 'blob:4' );
		expect( poser.pose ).toHaveBeenCalledOnce();
		const [ recipe, clip ] = poser.pose.mock.calls[ 0 ];
		expect( clip ).toBe( 'Idle_Loop' );
		expect( recipe.body ).toBeTruthy();
		expect( poser.released ).toHaveLength( 1 );
		expect( portraits.scene.children ).toHaveLength( 3 );

		// The same person, or their recipe, is pictured once.
		expect( await portraits.portrait( { npcId: 'a2' } ) ).toBe( 'blob:4' );
		expect( await portraits.portrait( { recipe } ) ).toBe( 'blob:4' );
		expect( snapshots.take ).toHaveBeenCalledOnce();
		expect( await portraits.portrait( { npcId: 'gone' } ) ).toBeNull();
		expect( await portraits.portrait( {} ) ).toBeNull();

	} );

	it( 'frames the face a little under the head, from in front of it', () => {

		const camera = new THREE.PerspectiveCamera( 24, 1, 0.05, 20 );
		const target = frameFace( camera, new THREE.Vector3( 0, 1.6, 0 ) );
		expect( target.y ).toBeCloseTo( 1.6 );
		expect( camera.position.z ).toBeGreaterThan( 1 );
		expect( camera.position.x ).toBeGreaterThan( 0.4 );
		const forward = camera.getWorldDirection( new THREE.Vector3() );
		expect( forward.z ).toBeLessThan( - 0.8 );

	} );

} );
