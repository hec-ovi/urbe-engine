import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { HeroCharacter } from './HeroCharacter.js';
import { hairColorNode } from './HairMesh.js';
import { look } from './Appearance.js';
import { CROWD_SURFACE } from './CrowdMesh.js';
import { SPEECH_LIMITS } from './SpeechGesture.js';
import { StreetBodies } from './StreetBodies.js';
import { Physics } from '../physics/index.js';
import { ActorLighting } from '../light/ActorLighting.js';
import { FillChannel } from '../city/kit/FillChannel.js';
import { animation, outfit, rig, rootTurn } from './HeroCharacter.test-fixtures.js';

// Which map and which tint each hair material multiplies, as the crowd's HairMesh does.
vi.mock( './HairMesh.js', async ( original ) => {

	const module = await original();
	return { ...module, hairColorNode: vi.fn( module.hairColorNode ) };

} );

describe( 'focused character', () => {

	it( 'keeps the actual focused body and hair lit through movement, preparation and wardrobe reuse', async () => {

		const fill = new THREE.Vector4( 20, 14, 8, 0.4 );
		const lighting = new ActorLighting( { spots: [], strips: [] }, () => [ { holds: ( position ) => position.x > 0, fill } ] );
		const hero = new HeroCharacter( {
			animation: animation(), lighting,
			loadModel: () => ( { scene: rig( 'body' ), hairs: [ { scene: rig( 'hair' ) } ] } )
		} );
		await hero.prepare();
		const person = { gender: 'male', variant: 0, appearanceSeed: 3, clip: 3, hero: false, position: new THREE.Vector3( 1, 0, 1 ), heading: 0, look: outfit() };
		await hero.show( person );
		const root = hero.active.root;
		const meshes = [];
		root.traverse( ( node ) => { if ( node.isMesh ) meshes.push( node ); } );
		const channel = FillChannel.of( meshes[ 0 ] );
		expect( meshes.length ).toBeGreaterThan( 1 );
		for ( const mesh of meshes ) {

			expect( FillChannel.of( mesh ) ).toBe( channel );
			expect( mesh.material.actorRoomNode ).toBe( lighting.node );

		}
		expect( Array.from( channel.texture.image.data.slice( 0, 3 ) ) ).toEqual( [ 20, 14, 8 ] );
		person.position.x = - 1;
		hero.update( 0.1 );
		expect( Array.from( channel.texture.image.data ) ).toEqual( [ 0, 0, 0, 0 ] );
		const dispose = vi.spyOn( channel.texture, 'dispose' );
		const material = meshes[ 0 ].material;
		hero.hide();
		expect( dispose ).toHaveBeenCalledOnce();
		person.position.x = 1;
		await hero.show( person );
		const again = [];
		hero.active.root.traverse( ( node ) => { if ( node.isMesh ) again.push( node ); } );
		expect( again[ 0 ].material ).toBe( material );
		expect( FillChannel.of( again[ 0 ] ) ).not.toBe( channel );
		hero.hide();

	} );

	it( 'loads one deterministic full model once for the run, warms it, dresses it in a material the model keeps, and replaces only that crowd slot', async () => {

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
			gender: 'female', variant: 1, appearanceSeed: 7, clip: 2, hero: false,
			position: new THREE.Vector3( 4, 0, 8 ), heading: 1.2, look: outfit()
		};

		expect( await hero.show( person ) ).toBe( true );
		expect( loaded ).toHaveLength( 1 );
		expect( loaded[ 0 ].gender ).toBe( 'female' );
		expect( loaded[ 0 ].file ).toBe( 'Regular_Female_FullBody.gltf' );
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

		// The next person of that shape wears the same material with their own
		// colours; the model, its maps and its material are never dropped.
		const next = { ...person, look: { ...outfit(), shirt: new THREE.Color( 0xff0000 ), hem: 0.5 } };
		expect( await hero.show( next ) ).toBe( true );
		expect( loaded ).toHaveLength( 1 );
		expect( dispose ).not.toHaveBeenCalled();
		const again = [];
		hero.active.root.traverse( ( node ) => { if ( node.isSkinnedMesh ) again.push( node ); } );
		expect( again[ 0 ].material ).toBe( body.material );
		expect( hero.active.root.userData.dressed.look.shirt.value.getHex() ).toBe( 0xff0000 );
		expect( hero.active.root.userData.dressed.look.hem.value ).toBe( 0.5 );
		hero.hide();

	} );

	it( 'prepares both shapes at load through the warm-up, so a first conversation or fall reads and links nothing', async () => {

		const loaded = [];
		const warmed = [];
		const built = new Set();
		const hero = new HeroCharacter( {
			animation: animation(),
			warmup: { warm: async ( root ) => {

				warmed.push( root.name );
				root.traverse( ( node ) => { if ( node.isMesh ) built.add( node.material ); } );
				return 0;

			} },
			loadModel: ( descriptor ) => {

				loaded.push( descriptor.gender );
				return { scene: rig( 'body', { eyebrows: true } ), hairs: [ { scene: rig( 'hair' ) } ] };

			}
		} );
		const progress = [];

		await hero.prepare( ( done, total ) => progress.push( [ done, total ] ) );

		expect( loaded ).toEqual( [ 'male', 'female' ] );
		expect( warmed ).toEqual( [ 'prepared-regular-male', 'prepared-regular-female' ] );
		expect( progress ).toEqual( [ [ 1, 2 ], [ 2, 2 ] ] );
		expect( hero.group.children ).toHaveLength( 0 );

		const person = { gender: 'male', variant: 0, appearanceSeed: 3, clip: 1, hero: false, position: new THREE.Vector3(), heading: 0, look: outfit() };
		expect( await hero.show( person ) ).toBe( true );
		expect( loaded ).toHaveLength( 2 );
		// The prepared root's materials were handed back and are what this
		// person wears, tinted hairstyle and eyebrows included.
		expect( hero.poser.models.size ).toBe( 2 );
		expect( ( await hero.poser.models.get( 'regular-male:Hairstyles/Rigged to Head Bone/Male/Hair_SimpleParted.gltf' ) ).wardrobe ).toHaveLength( 1 );
		const worn = [];
		hero.active.root.traverse( ( node ) => { if ( node.isMesh ) worn.push( node ); } );
		expect( worn.filter( ( mesh ) => mesh.userData.hair ) ).toHaveLength( 2 );
		expect( worn.every( ( mesh ) => built.has( mesh.material ) ) ).toBe( true );

	} );

	it( 'wears every channel of the crowd look, the hair tint on hairstyle and eyebrows, over the crowd surface', async () => {

		vi.mocked( hairColorNode ).mockClear();
		const hero = new HeroCharacter( {
			animation: animation(),
			loadModel: () => ( { scene: rig( 'body', { eyebrows: true } ), hairs: [ { scene: rig( 'hair' ) } ] } )
		} );
		const seed = 2754811393;
		const person = {
			npcId: 'n1', gender: 'female', variant: 1, appearanceSeed: seed, clip: 1, hero: false,
			position: new THREE.Vector3(), heading: 0, look: look( seed )
		};
		await hero.show( person );
		const { root } = hero.active;
		const dressed = root.userData.dressed;
		for ( const [ channel, value ] of Object.entries( person.look ) ) {

			const worn = dressed.look[ channel ]?.value;
			expect( { channel, worn: worn?.isColor ? worn.getHex() : worn } ).toEqual( { channel, worn: value.isColor ? value.getHex() : value } );

		}

		const meshes = [];
		root.traverse( ( node ) => { if ( node.isMesh ) meshes.push( node ); } );
		const hairs = meshes.filter( ( mesh ) => mesh.userData.hair );
		expect( hairs.map( ( mesh ) => mesh.name ).sort() ).toEqual( [ 'Eyebrows', 'hair' ] );
		for ( const mesh of [ ...hairs, meshes.find( ( node ) => node.name === 'body' ) ] ) {

			expect( mesh.material ).toBeInstanceOf( THREE.MeshStandardNodeMaterial );
			expect( mesh.material ).toMatchObject( { ...CROWD_SURFACE, normalMap: null, roughnessMap: null } );

		}
		// Each is the pack's own hair map times the person's tint, as in the crowd.
		const source = await hero.poser.models.values().next().value;
		const maps = [];
		source.scene.traverse( ( node ) => { if ( node.userData.hair ) maps.push( node.material.map ); } );
		expect( vi.mocked( hairColorNode ).mock.calls ).toEqual( maps.map( ( map ) => [ map, dressed.look.hair ] ) );
		expect( new Set( hairs.map( ( mesh ) => mesh.material ) ) ).toEqual( new Set( dressed.hairs.values() ) );

		// The next person of that shape wears the same materials in their own colour.
		hero.hide();
		const other = 97531;
		await hero.show( { ...person, npcId: 'n2', appearanceSeed: other, look: look( other ) } );
		const again = [];
		hero.active.root.traverse( ( node ) => { if ( node.userData.hair ) again.push( node.material ); } );
		expect( again ).toEqual( hairs.map( ( mesh ) => mesh.material ) );
		expect( dressed.look.hair.value.getHex() ).toBe( look( other ).hair.getHex() );
		expect( hairColorNode ).toHaveBeenCalledTimes( 2 );

	} );

	it( 'wears the crowd body the person walks in, and swaps it only when that body changes', async () => {

		const loaded = [];
		const hero = new HeroCharacter( {
			animation: animation(),
			loadModel: ( descriptor ) => { loaded.push( descriptor.id ); return { scene: rig( 'body' ), hairs: [] }; }
		} );
		// Gender and seed alone would pick the other body.
		const person = {
			npcId: 'n1', gender: null, variant: 0, appearanceSeed: 3, clip: 1, hero: false,
			position: new THREE.Vector3(), heading: 0, look: outfit()
		};
		await hero.show( person );
		expect( loaded ).toEqual( [ 'regular-male' ] );

		await hero.show( person );
		expect( loaded ).toEqual( [ 'regular-male' ] );
		await hero.show( { ...person, variant: 1 } );
		expect( loaded ).toEqual( [ 'regular-male', 'regular-female' ] );
		expect( hero.active.descriptor.id ).toBe( 'regular-female' );

	} );

	it( 'wears a new look on the resident rig as soon as its person has one', async () => {

		const hero = new HeroCharacter( {
			animation: animation(),
			loadModel: () => ( { scene: rig( 'body', { eyebrows: true } ), hairs: [ { scene: rig( 'hair' ) } ] } )
		} );
		const person = {
			npcId: 'n1', gender: 'male', variant: 0, appearanceSeed: 11, clip: 1, hero: false,
			position: new THREE.Vector3(), heading: 0, look: look( 11 )
		};
		await hero.show( person );
		const { root } = hero.active;
		const worn = () => ( {
			shirt: root.userData.dressed.look.shirt.value.getHex(),
			hair: root.userData.dressed.look.hair.value.getHex()
		} );
		const wearing = ( seed ) => ( { shirt: look( seed ).shirt.getHex(), hair: look( seed ).hair.getHex() } );

		person.look = look( 2754811393 );
		hero.update( 0 );
		expect( worn() ).toEqual( wearing( 2754811393 ) );

		await hero.show( { ...person, look: look( 97531 ) } );
		expect( hero.active.root ).toBe( root );
		expect( worn() ).toEqual( wearing( 97531 ) );

	} );

	it( 'plays ordered one-shot entry into a held loop on the same focused rig', async () => {

		const hero = new HeroCharacter( {
			animation: animation(),
			loadModel: () => ( { scene: rig( 'body' ) } )
		} );
		const person = {
			npcId: 'npc-follower', gender: 'female', variant: 1, appearanceSeed: 7, clip: 0, hero: false,
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

	it( 'starts where the crowd body stood, in its clip at its frame, and blends from there or plays the same loop on', async () => {

		const hero = new HeroCharacter( { animation: animation(), loadModel: () => ( { scene: rig( 'body' ) } ) } );
		const actionOf = ( name ) => hero.active.mixer.existingAction( hero.active.motions.clip( THREE.AnimationClip.findByName( hero.animation.animations, name ) ) );
		// Standing idle a quarter into the loop (frame 8 of 32), then talking.
		const person = {
			npcId: 'n1', gender: 'male', variant: 0, appearanceSeed: 3, clip: 1, frame: 8, hero: false,
			position: new THREE.Vector3(), heading: 0, look: outfit()
		};
		await hero.show( person, [ { clipName: 'Idle_Talking_Loop', loop: true, blendMs: 200 } ] );
		const [ idle, talk ] = [ actionOf( 'Idle_Loop' ), actionOf( 'Idle_Talking_Loop' ) ];
		expect( idle.time ).toBeCloseTo( 0.25 );
		expect( talk.time ).toBe( 0 );
		hero.update( 0.1 );
		expect( idle.getEffectiveWeight() ).toBeCloseTo( 0.5 );
		expect( talk.getEffectiveWeight() ).toBeCloseTo( 0.5 );
		hero.update( 0.15 );
		expect( talk.getEffectiveWeight() ).toBe( 1 );
		expect( idle.enabled ).toBe( false );

		// Seated three quarters into the loop, and sitting on: the same loop plays on from there, asked again or not.
		hero.hide();
		await hero.show( { ...person, clip: 3, frame: 24 }, [ { clipName: 'Sitting_Idle_Loop', loop: true } ] );
		const sitting = actionOf( 'Sitting_Idle_Loop' );
		expect( sitting.time ).toBeCloseTo( 0.75 );
		hero.update( 0.1 );
		hero.play( [ { clipName: 'Sitting_Idle_Loop', loop: true } ] );
		expect( sitting.time ).toBeCloseTo( 0.85 );
		expect( sitting.getEffectiveWeight() ).toBe( 1 );

	} );

	it( 'plays an entry on a new rig from the pose the crowd body shows, never from where the entry ends', async () => {

		// Standing upright, the entry bends the root a radian over its second and the crouch holds it there.
		const hero = new HeroCharacter( {
			animation: animation( { Crouch_Enter: [ 0, 1 ], Crouch_Idle_Loop: [ 1, 1 ] } ),
			loadModel: () => ( { scene: rig( 'body' ) } )
		} );
		const person = {
			npcId: 'n1', gender: 'male', variant: 0, appearanceSeed: 3, clip: 1, frame: 8, hero: false,
			position: new THREE.Vector3(), heading: 0, look: outfit()
		};
		await hero.show( person, [ { clipName: 'Crouch_Enter', loop: false }, { clipName: 'Crouch_Idle_Loop', loop: true } ] );
		const turns = [];
		hero.update( 0 );
		turns.push( rootTurn( hero.active.root ) );
		for ( let frame = 1; frame <= 90; frame ++ ) {

			hero.update( 1 / 60 );
			turns.push( rootTurn( hero.active.root ) );

		}

		// The first frame stands as the crowd body stood; the entry then bends
		// the body down, never ahead of its own time and never back up.
		expect( turns[ 0 ] ).toBeCloseTo( 0, 6 );
		turns.forEach( ( turn, frame ) => {

			expect( turn ).toBeLessThanOrEqual( frame / 60 + 1e-6 );
			if ( frame > 0 ) expect( turn ).toBeGreaterThanOrEqual( turns[ frame - 1 ] - 1e-6 );

		} );
		expect( turns.at( - 1 ) ).toBeCloseTo( 1, 3 );

	} );

	it( 'moves the head of the person whose voice plays over the clip, and hands it back to the clip once the voice ends', async () => {

		const hero = new HeroCharacter( { animation: animation(), loadModel: () => ( { scene: rig( 'body' ) } ) } );
		const person = {
			npcId: 'n1', gender: 'male', variant: 0, appearanceSeed: 3, clip: 2, frame: 0, hero: false,
			position: new THREE.Vector3(), heading: 0, look: outfit()
		};
		await hero.show( person );
		const head = hero.active.root.getObjectByName( 'Head' );
		hero.update( 1 / 60 );
		const pose = head.quaternion.clone();
		const turns = [];
		const frames = ( seconds ) => {

			for ( let frame = 0; frame < seconds * 60; frame ++ ) {

				time += 1 / 60;
				hero.update( 1 / 60 );
				turns.push( head.quaternion.angleTo( pose ) );

			}

		};
		let time = 0;
		const speech = { seed: 9, loudness: () => 0.08 * ( 0.5 + 0.5 * Math.sin( 2 * Math.PI * 4 * time ) ) ** 2 };

		hero.speak( 'n2', speech );
		frames( 1 );
		expect( Math.max( ...turns ) ).toBe( 0 );

		hero.speak( 'n1', speech );
		frames( 2 );
		expect( Math.max( ...turns ) ).toBeGreaterThan( 0.5 * Math.PI / 180 );
		expect( Math.max( ...turns ) ).toBeLessThan( Math.hypot( ...Object.values( SPEECH_LIMITS ) ) );

		hero.speak( 'n2', null );
		expect( hero.speech ).toMatchObject( { npcId: 'n1', seed: 9 } );
		hero.speak( 'n1', null );
		frames( 3 );
		expect( head.quaternion.equals( pose ) ).toBe( true );

	} );

	it( 'replaces the baked slot with the same articulated Source body for a measured impact', async () => {

		const source = humanoidRig();
		const headTurn = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), 0.6 );
		const clip = new THREE.AnimationClip( 'Walk_Loop', 1, [
			new THREE.QuaternionKeyframeTrack( 'Head.quaternion', [ 0, 0.5, 1 ], [
				0, 0, 0, 1, ...headTurn.toArray(), 0, 0, 0, 1
			] )
		] );
		const street = new StreetBodies();
		const hero = new HeroCharacter( {
			animation: { scene: humanoidRig(), animations: [ clip ] },
			loadModel: () => ( { scene: source } ),
			street
		} );
		const physics = await Physics.create();
		physics.addTrimesh( new THREE.BoxGeometry( 20, 0.1, 20 ).translate( 0, - 0.05, 0 ) );
		const person = {
			id: 'p1', npcId: 'npc-impact', gender: 'female', variant: 1, appearanceSeed: 7,
			clip: 0, frame: 16, hero: false, position: new THREE.Vector3(), heading: 0
		};
		street.enter( person );

		expect( await hero.fall( person, physics, {
			point: { x: 0, y: 1.4, z: 0 }, impulse: { x: 18, y: 2, z: 0 }
		} ) ).toBe( true );
		expect( person.hero ).toBe( true );
		expect( hero.fallen.ragdoll.summary ).toEqual( { bodies: 15, joints: 14, totalMassKg: 70 } );
		expect( hero.fallen.root.getObjectByName( 'Head' ).quaternion.angleTo( headTurn ) ).toBeLessThan( 1e-3 );
		expect( hero.group.children ).toEqual( [ hero.fallen.root ] );

		physics.step( 1 / 60 );
		hero.update( 1 / 60 );
		expect( person.position.x ).toBeGreaterThan( 0 );
		expect( hero.fallen ).toBeTruthy();

		// the fall ends by itself: the body stops moving, or its time is up
		hero.update( 6 );
		expect( hero.fallen ).toBeNull();
		expect( person.hero ).toBe( false );
		expect( hero.group.children ).toEqual( [] );
		expect( street.done().map( ( record ) => record.member ) ).toEqual( [ person ] );

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
