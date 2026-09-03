import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { HeroCharacter } from './HeroCharacter.js';
import { Physics } from '../physics/index.js';

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

	it( 'replaces the baked slot with the same articulated Source body for a measured impact', async () => {

		const source = humanoidRig();
		const clip = new THREE.AnimationClip( 'Walk_Loop', 1, [] );
		const hero = new HeroCharacter( {
			animation: { scene: humanoidRig(), animations: [ clip ] },
			loadModel: () => ( { scene: source } )
		} );
		const physics = await Physics.create();
		physics.addTrimesh( new THREE.BoxGeometry( 20, 0.1, 20 ).translate( 0, - 0.05, 0 ) );
		const person = {
			npcId: 'npc-impact', gender: 'female', appearanceSeed: 7,
			clip: 0, frame: 0, hero: false, position: new THREE.Vector3(), heading: 0
		};

		expect( await hero.fall( person, physics, {
			point: { x: 0, y: 1.4, z: 0 }, impulse: { x: 18, y: 2, z: 0 }
		} ) ).toBe( true );
		expect( person.hero ).toBe( true );
		expect( hero.fallen.ragdoll.summary ).toEqual( { bodies: 15, joints: 14, totalMassKg: 70 } );
		expect( hero.group.children ).toEqual( [ hero.fallen.root ] );

		physics.step( 1 / 60 );
		hero.update( 1 / 60 );
		expect( hero.clearFall() ).toMatchObject( { npcId: 'npc-impact', hero: false } );
		expect( hero.group.children ).toEqual( [] );

	} );

} );

function humanoidRig() {

	const root = new THREE.Group();
	const armature = namedBone( 'root', [ 0, 0, 0 ] );
	const pelvis = namedBone( 'pelvis', [ 0, 0.95, 0 ] );
	armature.add( pelvis );
	root.add( armature );
	const spine1 = namedBone( 'spine_01', [ 0, 0.14, 0 ] );
	const spine2 = namedBone( 'spine_02', [ 0, 0.12, 0 ] );
	const spine3 = namedBone( 'spine_03', [ 0, 0.14, 0 ] );
	const neck = namedBone( 'neck_01', [ 0, 0.14, 0 ] );
	const head = namedBone( 'Head', [ 0, 0.1, 0 ] );
	pelvis.add( spine1 );
	spine1.add( spine2 );
	spine2.add( spine3 );
	spine3.add( neck );
	neck.add( head );
	addArm( spine3, 'l', 1 );
	addArm( spine3, 'r', - 1 );
	addLeg( pelvis, 'l', 1 );
	addLeg( pelvis, 'r', - 1 );

	const bones = [];
	root.traverse( ( node ) => { if ( node.isBone ) bones.push( node ); } );
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [ 0, 0, 0 ], 3 ) );
	geometry.setAttribute( 'skinIndex', new THREE.Uint16BufferAttribute( [ 0, 0, 0, 0 ], 4 ) );
	geometry.setAttribute( 'skinWeight', new THREE.Float32BufferAttribute( [ 1, 0, 0, 0 ], 4 ) );
	const mesh = new THREE.SkinnedMesh( geometry, new THREE.MeshStandardMaterial() );
	mesh.name = 'body';
	mesh.add( armature );
	mesh.bind( new THREE.Skeleton( bones ) );
	root.add( mesh );
	root.updateWorldMatrix( true, true );
	return root;

}

function addArm( parent, side, direction ) {

	const clavicle = namedBone( `clavicle_${side}`, [ direction * 0.08, 0.06, 0 ] );
	const upper = namedBone( `upperarm_${side}`, [ direction * 0.12, 0, 0 ] );
	const lower = namedBone( `lowerarm_${side}`, [ direction * 0.25, 0, 0 ] );
	const hand = namedBone( `hand_${side}`, [ direction * 0.24, 0, 0 ] );
	parent.add( clavicle );
	clavicle.add( upper );
	upper.add( lower );
	lower.add( hand );

}

function addLeg( parent, side, direction ) {

	const thigh = namedBone( `thigh_${side}`, [ direction * 0.1, - 0.04, 0 ] );
	const calf = namedBone( `calf_${side}`, [ 0, - 0.43, 0 ] );
	const foot = namedBone( `foot_${side}`, [ 0, - 0.43, 0.02 ] );
	const ball = namedBone( `ball_${side}`, [ 0, - 0.08, 0.16 ] );
	parent.add( thigh );
	thigh.add( calf );
	calf.add( foot );
	foot.add( ball );

}

function namedBone( name, position ) {

	const value = new THREE.Bone();
	value.name = name;
	value.position.fromArray( position );
	return value;

}

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
