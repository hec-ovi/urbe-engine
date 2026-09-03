import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { HeroCharacter } from './HeroCharacter.js';

describe( 'focused character', () => {

	it( 'loads one deterministic full model, warms it, and replaces only that crowd slot', async () => {

		const loaded = [];
		const warm = vi.fn().mockResolvedValue( 0 );
		const hero = new HeroCharacter( {
			animation: animation(),
			warmup: { warm },
			loadModel: ( descriptor ) => {

				loaded.push( descriptor );
				return { scene: rig( 'body' ), hairs: [ { scene: rig( 'hair' ) }, { scene: rig( 'facial-hair' ) } ] };

			}
		} );
		const person = {
			gender: 'female', appearanceSeed: 7, clip: 2, hero: false,
			position: new THREE.Vector3( 4, 0, 8 ), heading: 1.2, look: outfit()
		};

		expect( await hero.show( person ) ).toBe( true );
		expect( loaded ).toHaveLength( 1 );
		expect( loaded[ 0 ].gender ).toBe( 'female' );
		expect( person.hero ).toBe( true );
		expect( hero.active.root.position ).toEqual( person.position );
		expect( warm ).toHaveBeenCalledOnce();
		const meshes = [];
		hero.active.root.traverse( ( node ) => { if ( node.isMesh ) meshes.push( node ); } );
		expect( meshes.filter( ( mesh ) => mesh.isSkinnedMesh ) ).toHaveLength( 1 );
		expect( meshes.find( ( mesh ) => mesh.name === 'hair' ).parent.name ).toBe( 'Head' );
		expect( meshes.find( ( mesh ) => mesh.name === 'facial-hair' ).parent.name ).toBe( 'Head' );
		const body = meshes.find( ( mesh ) => mesh.isSkinnedMesh );
		expect( body.material ).toBeInstanceOf( THREE.MeshStandardNodeMaterial );
		expect( body.geometry.hasAttribute( 'cloth' ) ).toBe( true );
		const dispose = vi.spyOn( body.material, 'dispose' );

		hero.hide();
		expect( person.hero ).toBe( false );
		expect( hero.group.children ).toHaveLength( 0 );
		expect( dispose ).toHaveBeenCalledOnce();

	} );

	it( 'keeps the baked person visible when a stale load finishes', async () => {

		let resolve;
		const waiting = new Promise( ( done ) => { resolve = done; } );
		const hero = new HeroCharacter( {
			animation: animation(),
			loadModel: () => waiting
		} );
		const person = {
			gender: 'male', appearanceSeed: 0, clip: 2, hero: false,
			position: new THREE.Vector3(), heading: 0
		};

		const show = hero.show( person );
		hero.hide();
		resolve( { scene: rig() } );

		expect( await show ).toBe( false );
		expect( person.hero ).toBe( false );

	} );

	it( 'keeps only the active full-resolution shape resident', async () => {

		const hero = new HeroCharacter( {
			animation: animation(),
			loadModel: () => ( { scene: rig( 'body' ), hair: { scene: rig( 'hair' ) } } )
		} );
		const person = ( seed ) => ( {
			gender: 'female', appearanceSeed: seed, clip: 2, hero: false,
			position: new THREE.Vector3(), heading: 0
		} );

		await hero.show( person( 0 ) );
		await hero.show( person( 1 ) );

		expect( hero.models.size ).toBe( 1 );
		expect( hero.active.descriptor.id ).toBe( 'teen-female' );

	} );

	it( 'plays ordered one-shot entry into a held loop on the same focused rig', async () => {

		const hero = new HeroCharacter( {
			animation: animation(),
			loadModel: () => ( { scene: rig( 'body' ) } )
		} );
		const person = {
			npcId: 'npc-follower', gender: 'female', appearanceSeed: 7, clip: 0, hero: false,
			position: new THREE.Vector3(), heading: 0, look: outfit()
		};
		await hero.show( person, [
			{ clipName: 'Sprint_Enter', loop: false, blendMs: 0 },
			{ clipName: 'Sprint_Loop', loop: true, blendMs: 80 }
		] );

		expect( hero.active.currentClip ).toBe( 'Sprint_Enter' );
		hero.update( 1.1 );
		expect( hero.active.currentClip ).toBe( 'Sprint_Loop' );

	} );

	it( 'changes a loaded actor without reloading its original model and reports one-shot completion', async () => {

		const loadModel = vi.fn( () => ( { scene: rig( 'body' ) } ) );
		const finished = vi.fn();
		const hero = new HeroCharacter( { animation: animation(), loadModel } );
		const person = {
			npcId: 'npc-reader', gender: 'male', appearanceSeed: 2, clip: 0, hero: false,
			position: new THREE.Vector3(), heading: 0, look: outfit()
		};
		await hero.show( person, [ { clipName: 'Idle_Loop', loop: true, blendMs: 0 } ] );
		await hero.show( { ...person, position: new THREE.Vector3( 2, 0, 0 ) }, [
			{ clipName: 'Idle_Paper', loop: false, blendMs: 120 }
		], finished );

		expect( loadModel ).toHaveBeenCalledOnce();
		expect( hero.active.currentClip ).toBe( 'Idle_Paper' );
		hero.update( 1.1 );
		expect( finished ).toHaveBeenCalledOnce();

	} );

	it( 'rejects a missing transition clip before replacing the visible actor', async () => {

		const hero = new HeroCharacter( {
			animation: animation(),
			loadModel: () => ( { scene: rig( 'body' ) } )
		} );
		const person = {
			npcId: 'npc-safe', gender: 'female', appearanceSeed: 7, clip: 2, hero: false,
			position: new THREE.Vector3(), heading: 0, look: outfit()
		};
		await hero.show( person );

		await expect( hero.show( { ...person, npcId: 'npc-other' }, [
			{ clipName: 'Does_Not_Exist', loop: true, blendMs: 0 }
		] ) ).rejects.toThrow( /Does_Not_Exist/ );
		expect( hero.active.person.npcId ).toBe( 'npc-safe' );

	} );

} );

function rig( name = 'body' ) {

	const root = new THREE.Group();
	const bone = new THREE.Bone();
	bone.name = 'root';
	const head = new THREE.Bone();
	head.name = 'Head';
	bone.add( head );
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [ 0, 0, 0 ], 3 ) );
	geometry.setAttribute( 'skinIndex', new THREE.Uint16BufferAttribute( [ 0, 0, 0, 0 ], 4 ) );
	geometry.setAttribute( 'skinWeight', new THREE.Float32BufferAttribute( [ 1, 0, 0, 0 ], 4 ) );
	const mesh = new THREE.SkinnedMesh( geometry, new THREE.MeshStandardMaterial( { map: new THREE.Texture() } ) );
	mesh.name = name;
	mesh.add( bone );
	mesh.bind( new THREE.Skeleton( [ bone, head ] ) );
	root.add( mesh );

	return root;

}

function outfit() {

	return {
		skin: new THREE.Color( 0xffffff ),
		shirt: new THREE.Color( 0x446688 ),
		trousers: new THREE.Color( 0x222833 ),
		sleeve: 0.55,
		hem: 0.88
	};

}

function animation() {

	const scene = rig();
	const times = [ 0, 1 ];
	const values = [ 0, 0, 0, 1, 0, 0, 0, 1 ];

	return {
		scene,
		animations: [
			new THREE.AnimationClip( 'Idle_Talking_Loop', 1, [ new THREE.QuaternionKeyframeTrack( 'root.quaternion', times, values ) ] ),
			new THREE.AnimationClip( 'Sitting_Talking_Loop', 1, [ new THREE.QuaternionKeyframeTrack( 'root.quaternion', times, values ) ] ),
			new THREE.AnimationClip( 'Idle_Loop', 1, [ new THREE.QuaternionKeyframeTrack( 'root.quaternion', times, values ) ] ),
			new THREE.AnimationClip( 'Idle_Paper', 1, [ new THREE.QuaternionKeyframeTrack( 'root.quaternion', times, values ) ] ),
			new THREE.AnimationClip( 'Sprint_Enter', 1, [ new THREE.QuaternionKeyframeTrack( 'root.quaternion', times, values ) ] ),
			new THREE.AnimationClip( 'Sprint_Loop', 1, [ new THREE.QuaternionKeyframeTrack( 'root.quaternion', times, values ) ] )
		]
	};

}
