import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { CLOSE_RIGS, HeroCharacter } from './HeroCharacter.js';
import { CROWD_SURFACE } from './CrowdMesh.js';
import { SPEECH_LIMITS } from './SpeechGesture.js';
import { StreetBodies } from './StreetBodies.js';
import { GARMENTS } from './avatar/Recipe.js';
import { Physics } from '../physics/index.js';
import { ActorLighting } from '../light/ActorLighting.js';
import { FillChannel } from '../city/kit/FillChannel.js';
import { animation, heroRigs, humanoid, outfit, rig, rootTurn } from './HeroCharacter.test-fixtures.js';

const hex = ( color ) => `#${color.getHexString()}`;

describe( 'focused character', () => {

	it( 'keeps the actual focused body, garments and hair lit through movement, preparation and wardrobe reuse', async () => {

		const fill = new THREE.Vector4( 20, 14, 8, 0.4 );
		const lighting = new ActorLighting( { spots: [], strips: [] }, () => [ { holds: ( position ) => position.x > 0, fill } ] );
		const hero = new HeroCharacter( heroRigs( { lighting } ) );
		await hero.prepare();
		const person = { gender: 'male', variant: 0, appearanceSeed: 3, clip: 3, hero: false, position: new THREE.Vector3( 1, 0, 1 ), heading: 0, look: outfit() };
		await hero.show( person );
		const root = hero.active.root;
		const meshes = [];
		root.traverse( ( node ) => { if ( node.isMesh ) meshes.push( node ); } );
		const channel = FillChannel.of( meshes[ 0 ] );
		expect( meshes.filter( ( mesh ) => mesh.name.startsWith( 'garment-' ) ) ).toHaveLength( 3 );
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

	it( 'reads a body once for the run, warms it, dresses the person in their recipe in materials the body keeps, and replaces only that crowd slot', async () => {

		const loaded = [];
		const hairs = [];
		const warm = vi.fn().mockResolvedValue( 0 );
		const tailor = heroRigs().tailor;
		const hero = new HeroCharacter( heroRigs( {
			warmup: { warm }, tailor,
			loadModel: ( descriptor ) => {

				loaded.push( descriptor );
				return { scene: rig( 'body', { eyebrows: true } ) };

			},
			loadHair: ( path ) => {

				hairs.push( path );
				return { scene: rig( 'hair' ) };

			}
		} ) );
		const look = outfit( 'female' );
		const person = { gender: 'female', variant: 1, appearanceSeed: 7, clip: 2, hero: false, position: new THREE.Vector3( 4, 0, 8 ), heading: 1.2, look };

		expect( await hero.show( person ) ).toBe( true );
		expect( loaded.map( ( descriptor ) => descriptor.file ) ).toEqual( [ 'Regular_Female_FullBody.gltf' ] );
		expect( hairs ).toEqual( [ look.recipe.hair ] );
		expect( tailor.prepared ).toHaveLength( 1 );
		expect( person.hero ).toBe( true );
		expect( hero.active.root.position ).toEqual( person.position );
		expect( warm ).toHaveBeenCalledOnce();
		const meshes = [];
		hero.active.root.traverse( ( node ) => { if ( node.isMesh ) meshes.push( node ); } );
		const body = meshes.find( ( mesh ) => mesh.name === 'body' );
		expect( meshes.find( ( mesh ) => mesh.name === 'hair' ).parent.name ).toBe( 'Head' );
		expect( hero.active.root.userData.hairStyle ).toBe( look.recipe.hair );
		// A skinned shell per garment, on the body's own skeleton and bind.
		const garments = meshes.filter( ( mesh ) => mesh.userData.garment );
		expect( garments.map( ( mesh ) => mesh.userData.garment ) ).toEqual( [
			{ id: 'tech-top', slot: 'top' }, { id: 'pants-tech', slot: 'pants' }, { id: 'boots-patrol', slot: 'footwear' }
		] );
		for ( const garment of garments ) {

			expect( garment.isSkinnedMesh ).toBe( true );
			expect( garment.skeleton ).toBe( body.skeleton );
			expect( garment.bindMatrix.equals( body.bindMatrix ) ).toBe( true );

		}
		expect( body.material ).toBeInstanceOf( THREE.MeshStandardNodeMaterial );
		const [ fit ] = tailor.fits.values();
		expect( fit.users ).toBe( 1 );
		const dispose = vi.spyOn( body.material, 'dispose' );

		hero.hide();
		expect( person.hero ).toBe( false );
		expect( hero.group.children ).toHaveLength( 0 );
		expect( fit.users ).toBe( 0 );

		// The next person of that body wears the same materials in their own
		// colours; the body, its maps and its materials are never dropped.
		const next = { ...person, npcId: 'n2', look: outfit( 'female', { colors: { skin: '#4b3026' }, outfit: { colors: { top: { primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff' } } } } ) };
		expect( await hero.show( next ) ).toBe( true );
		expect( loaded ).toHaveLength( 1 );
		expect( dispose ).not.toHaveBeenCalled();
		const again = [];
		hero.active.root.traverse( ( node ) => { if ( node.isMesh ) again.push( node ); } );
		expect( again.find( ( mesh ) => mesh.name === 'body' ).material ).toBe( body.material );
		expect( again.find( ( mesh ) => mesh.name === 'garment-tech-top' ).material ).toBe( garments[ 0 ].material );
		expect( hex( hero.active.root.userData.dressed.colors.skin ) ).toBe( '#4b3026' );
		expect( hex( hero.active.root.userData.dressed.panels.get( 'tech-top' ).palette[ 0 ] ) ).toBe( '#ff0000' );
		hero.hide();

	} );

	it( 'prepares both crowd bodies at load with every garment\'s program through the warm-up, so a first conversation or fall links nothing', async () => {

		const loaded = [];
		const warmed = [];
		const built = new Set();
		const hero = new HeroCharacter( heroRigs( {
			warmup: { warm: async ( root ) => {

				const garments = new Set();
				root.traverse( ( node ) => {

					if ( ! node.isMesh ) return;
					built.add( node.material );
					if ( node.material.userData.garment ) garments.add( node.material.userData.garment );

				} );
				warmed.push( [ root.name, garments.size ] );
				return 0;

			} },
			loadModel: ( descriptor ) => {

				loaded.push( descriptor.gender );
				return { scene: rig( 'body', { eyebrows: true } ) };

			}
		} ) );
		const progress = [];

		await hero.prepare( ( done, total ) => progress.push( [ done, total ] ) );

		const every = Object.values( GARMENTS ).flat().length;
		expect( loaded ).toEqual( [ 'male', 'female' ] );
		expect( warmed ).toEqual( [ [ 'prepared-regular-male', every ], [ 'prepared-regular-female', every ] ] );
		expect( progress ).toEqual( [ [ 1, 2 ], [ 2, 2 ] ] );
		expect( hero.group.children ).toHaveLength( 0 );

		const person = { gender: 'male', variant: 0, appearanceSeed: 3, clip: 1, hero: false, position: new THREE.Vector3(), heading: 0, look: outfit() };
		expect( await hero.show( person ) ).toBe( true );
		expect( loaded ).toHaveLength( 2 );
		// The prepared root's materials are what this person wears, their
		// garments' and tinted hairstyle and eyebrows included.
		const worn = [];
		hero.active.root.traverse( ( node ) => { if ( node.isMesh ) worn.push( node ); } );
		expect( worn.filter( ( mesh ) => mesh.userData.hair ) ).toHaveLength( 2 );
		expect( worn.filter( ( mesh ) => mesh.name.startsWith( 'sample-' ) ) ).toHaveLength( 0 );
		expect( worn.every( ( mesh ) => built.has( mesh.material ) ) ).toBe( true );

	} );

	it( 'wears every colour of the recipe: the skin, the hair on hairstyle and eyebrows, the eyes and each garment\'s panels and fabric', async () => {

		const hero = new HeroCharacter( heroRigs() );
		const look = outfit( 'female', {
			colors: { skin: '#895735', hair: '#d2c0a0', eyes: '#738ea1' },
			outfit: { top: 'office-jacket', fabric: 'woven', colors: { top: { primary: '#3c4f53', secondary: '#dedcd0', accent: '#ac9a76' } } }
		} );
		const person = { npcId: 'n1', gender: 'female', variant: 1, appearanceSeed: 5, clip: 1, hero: false, position: new THREE.Vector3(), heading: 0, look };
		await hero.show( person );
		const { root } = hero.active;
		const dressed = root.userData.dressed;
		expect( [ 'skin', 'hair', 'eyes' ].map( ( channel ) => hex( dressed.colors[ channel ] ) ) ).toEqual( [ '#895735', '#d2c0a0', '#738ea1' ] );
		const meshes = [];
		root.traverse( ( node ) => { if ( node.isMesh ) meshes.push( node ); } );
		const hairs = meshes.filter( ( mesh ) => mesh.userData.hair );
		expect( hairs.map( ( mesh ) => mesh.name ).sort() ).toEqual( [ 'Eyebrows', 'hair' ] );
		expect( new Set( hairs.map( ( mesh ) => mesh.material ) ) ).toEqual( new Set( hero.poser.wardrobe.hairs.values() ) );
		expect( meshes.every( ( mesh ) => hero.poser.wears( mesh ) === dressed ) ).toBe( true );
		expect( meshes.find( ( mesh ) => mesh.name === 'body' ).material ).toMatchObject( { ...CROWD_SURFACE, roughness: 0.86, normalMap: null, roughnessMap: null } );
		const jacket = meshes.find( ( mesh ) => mesh.name === 'garment-office-jacket' );
		expect( jacket.material ).toBe( hero.poser.wardrobe.garment( 'office-jacket' ) );
		const panels = dressed.panels.get( 'office-jacket' );
		expect( panels.palette.slice( 0, 3 ).map( hex ) ).toEqual( [ '#3c4f53', '#dedcd0', '#ac9a76' ] );
		expect( panels.roughness ).toBe( 0.9 );

	} );

	it( 'wears the recipe\'s own body, and builds a new rig only when its body, shape, hairstyle or garments change', async () => {

		const loaded = [];
		const hero = new HeroCharacter( heroRigs( { loadModel: ( descriptor ) => { loaded.push( descriptor.id ); return { scene: rig( 'body' ) }; } } ) );
		const person = { npcId: 'n1', gender: 'male', variant: 0, appearanceSeed: 3, clip: 1, hero: false, position: new THREE.Vector3(), heading: 0, look: outfit() };
		await hero.show( person );
		const root = hero.active.root;
		expect( loaded ).toEqual( [ 'regular-male' ] );

		await hero.show( { ...person, look: outfit( 'male', { colors: { skin: '#4b3026' } } ) } );
		expect( hero.active.root ).toBe( root );
		expect( hex( root.userData.dressed.colors.skin ) ).toBe( '#4b3026' );
		await hero.show( { ...person, look: outfit( 'male', { outfit: { top: 'top-tee' } } ) } );
		expect( hero.active.root ).not.toBe( root );
		expect( hero.active.root.getObjectByName( 'garment-top-tee' ) ).toBeTruthy();
		const teen = outfit( 'female' );
		teen.recipe = { ...teen.recipe, body: 'teen-female', hair: 'Hairstyles/Rigged to Head Bone/Female/Hair_Bob_Teen.gltf' };
		await hero.show( { ...person, look: teen } );
		expect( loaded ).toEqual( [ 'regular-male', 'teen-female' ] );
		expect( hero.active.descriptor.id ).toBe( 'teen-female' );

	} );

	it( 'wears a new look on the resident rig as soon as its person has one: its colours at once, new garments on a rig built and swapped in', async () => {

		const hero = new HeroCharacter( heroRigs() );
		const person = { npcId: 'n1', gender: 'male', variant: 0, appearanceSeed: 11, clip: 1, hero: false, position: new THREE.Vector3(), heading: 0, look: outfit() };
		await hero.show( person );
		const { root } = hero.active;

		person.look = outfit( 'male', { colors: { hair: '#b68d54' } } );
		hero.update( 0 );
		expect( hero.active.root ).toBe( root );
		expect( hex( root.userData.dressed.colors.hair ) ).toBe( '#b68d54' );

		person.look = outfit( 'male', { outfit: { pants: 'pants-shorts' } } );
		hero.update( 0 );
		await vi.waitFor( () => expect( hero.active.root ).not.toBe( root ) );
		expect( hero.active.root.getObjectByName( 'garment-pants-shorts' ) ).toBeTruthy();
		expect( hero.active.person ).toBe( person );
		// Playing what the rig it replaced played.
		expect( hero.active.currentClip ).toBe( 'Idle_Talking_Loop' );

	} );

	it( 'dresses the nearest people in their whole recipe, following their crowd body\'s place, clip and frame, and gives the rigs back when they leave', async () => {

		const tailor = heroRigs().tailor;
		const hero = new HeroCharacter( heroRigs( { tailor } ) );
		const people = [ 0, 1, 2 ].map( ( index ) => ( {
			id: `p${index}`, gender: 'male', variant: 0, appearanceSeed: index, clip: 0, frame: 8 * index, hero: false, presence: 1,
			position: new THREE.Vector3( index, 0, 2 ), heading: 0, look: outfit( 'male', { colors: { skin: [ '#edc6ac', '#895735', '#4b3026' ][ index ] } } )
		} ) );
		hero.near( people );
		await vi.waitFor( () => expect( people.map( ( person ) => person.hero ) ).toEqual( [ true, true, false ] ) );
		expect( CLOSE_RIGS ).toBe( 2 );
		expect( hero.group.children ).toHaveLength( 2 );
		const [ first ] = people;
		const rig = hero.rigOf( first );
		expect( rig.root.getObjectByName( 'garment-tech-top' ) ).toBeTruthy();
		expect( hex( rig.root.userData.dressed.colors.skin ) ).toBe( '#edc6ac' );

		// It stands where the body walks, in the body's clip at the body's frame.
		first.position.set( 5, 0, 5 );
		first.clip = 1;
		first.frame = 16;
		hero.update( 0.1 );
		expect( rig.root.position.toArray() ).toEqual( [ 5, 0, 5 ] );
		expect( rig.clipName ).toBe( 'Idle_Loop' );
		expect( rig.action.time ).toBeCloseTo( 0.5 );

		// Out of reach, the rig goes and the crowd body shows them again.
		hero.near( people.slice( 1 ) );
		expect( first.hero ).toBe( false );
		expect( hero.rigOf( first ) ).toBeNull();
		await vi.waitFor( () => expect( people[ 2 ].hero ).toBe( true ) );
		hero.near( [] );
		expect( people.map( ( person ) => person.hero ) ).toEqual( [ false, false, false ] );
		expect( hero.group.children ).toHaveLength( 0 );
		expect( [ ...tailor.fits.values() ].every( ( fit ) => fit.users === 0 ) ).toBe( true );

	} );

	it( 'hands a close person\'s rig to their talk with nothing built, and keeps them in it after while they stay close', async () => {

		const loaded = [];
		const tailor = heroRigs().tailor;
		const hero = new HeroCharacter( heroRigs( { tailor, loadModel: ( descriptor ) => { loaded.push( descriptor.id ); return { scene: rig( 'body' ) }; } } ) );
		const person = { id: 'p1', npcId: 'n1', gender: 'male', variant: 0, appearanceSeed: 3, clip: 0, frame: 4, hero: false, presence: 1, position: new THREE.Vector3(), heading: 0, look: outfit() };
		hero.near( [ person ] );
		await vi.waitFor( () => expect( person.hero ).toBe( true ) );
		const { root } = hero.rigOf( person );
		const built = tailor.fits.size;

		expect( await hero.show( person ) ).toBe( true );
		expect( hero.active.root ).toBe( root );
		expect( hero.close.size ).toBe( 0 );
		expect( tailor.fits.size ).toBe( built );
		expect( loaded ).toEqual( [ 'regular-male' ] );
		hero.update( 0.2 );
		expect( hero.active.currentClip ).toBe( 'Idle_Talking_Loop' );
		// Close while talking, the talk's rig is theirs alone.
		hero.near( [ person ] );
		expect( hero.close.size ).toBe( 0 );

		hero.hide();
		expect( hero.active ).toBeNull();
		expect( person.hero ).toBe( true );
		expect( hero.rigOf( person ).root ).toBe( root );
		hero.update( 0.1 );
		expect( hero.rigOf( person ).clipName ).toBe( 'Walk_Loop' );

		// Talked to away from anybody's reach, the rig goes with the talk.
		hero.near( [] );
		await hero.show( person );
		hero.hide();
		expect( person.hero ).toBe( false );
		expect( hero.group.children ).toHaveLength( 0 );

	} );

	it( 'plays ordered one-shot entry into a held loop on the same focused rig', async () => {

		const hero = new HeroCharacter( heroRigs() );
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

		const hero = new HeroCharacter( heroRigs() );
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
		const hero = new HeroCharacter( heroRigs( { animation: animation( { Crouch_Enter: [ 0, 1 ], Crouch_Idle_Loop: [ 1, 1 ] } ) } ) );
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

		const hero = new HeroCharacter( heroRigs() );
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

		const source = humanoid();
		const headTurn = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), 0.6 );
		const clip = new THREE.AnimationClip( 'Walk_Loop', 1, [
			new THREE.QuaternionKeyframeTrack( 'Head.quaternion', [ 0, 0.5, 1 ], [
				0, 0, 0, 1, ...headTurn.toArray(), 0, 0, 0, 1
			] )
		] );
		const street = new StreetBodies();
		const hero = new HeroCharacter( heroRigs( {
			animation: { scene: humanoid(), animations: [ clip ] },
			loadModel: () => ( { scene: source } ),
			loadHair: () => ( { scene: humanoid() } ),
			street
		} ) );
		const physics = await Physics.create();
		physics.addTrimesh( new THREE.BoxGeometry( 20, 0.1, 20 ).translate( 0, - 0.05, 0 ) );
		const person = {
			id: 'p1', npcId: 'npc-impact', gender: 'female', variant: 1, appearanceSeed: 7,
			clip: 0, frame: 16, hero: false, position: new THREE.Vector3(), heading: 0, look: outfit( 'female' )
		};
		street.enter( person );
		// Standing close and talked to when the car hits them.
		hero.near( [ person ] );
		await vi.waitFor( () => expect( hero.rigOf( person ) ).toBeTruthy() );
		await hero.show( person, [ { clipName: 'Walk_Loop', loop: true } ] );

		expect( await hero.fall( person, physics, {
			point: { x: 0, y: 1.4, z: 0 }, impulse: { x: 18, y: 2, z: 0 }
		} ) ).toBe( true );
		expect( person.hero ).toBe( true );
		expect( hero.rigOf( person ) ).toBeNull();
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
