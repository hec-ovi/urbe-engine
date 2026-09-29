import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { CharacterPoser } from './CharacterPoser.js';
import { HeroCharacter } from './HeroCharacter.js';
import { appearance } from './Appearance.js';
import { panelsOf } from './avatar/GarmentPanels.js';
import { SLOTS, personRecipe } from './avatar/Recipe.js';
import { animation, heroRigs, humanoid, plainTailor } from './HeroCharacter.test-fixtures.js';
import { SOURCE_PRESENT, animationLibrary, sourceLoaders } from './avatar/SourceAssets.test-fixtures.js';

const hex = ( color ) => `#${color.getHexString()}`;

/** A poser over the humanoid test rig, recording the bodies it reads. */
function humanoidPoser( loaded = [] ) {

	return new CharacterPoser( {
		animation: animation( {}, humanoid() ),
		tailor: plainTailor(),
		loadModel: ( descriptor ) => {

			loaded.push( descriptor.id );
			return { scene: humanoid( { eyebrows: true } ) };

		},
		loadHair: () => ( { scene: humanoid() } )
	} );

}

describe( 'still bodies', () => {

	it( 'lays out the person a gender and seed give, in their recipe and at their height, at the transferred final frame', async () => {

		const loaded = [];
		const poser = humanoidPoser( loaded );
		const seed = 2754811393;
		const { recipe } = appearance( { gender: 'female', appearanceSeed: seed } );
		const lying = await poser.still( { gender: 'female', appearanceSeed: seed }, 'Death01', 1 );
		expect( loaded ).toEqual( [ recipe.body ] );
		const dressed = lying.userData.dressed;
		expect( [ 'skin', 'hair', 'eyes' ].map( ( channel ) => hex( dressed.colors[ channel ].value ) ) )
			.toEqual( [ recipe.colors.skin, recipe.colors.hair, recipe.colors.eyes ] );
		const garments = [];
		lying.traverse( ( node ) => { if ( node.userData.garment ) garments.push( node ); } );
		expect( garments.map( ( mesh ) => mesh.userData.garment.id ) ).toEqual( SLOTS.map( ( slot ) => recipe.outfit[ slot ] ) );
		expect( hex( panelsOf( garments[ 0 ].material ).primary ) ).toBe( recipe.outfit.colors.top.primary );
		expect( poser.height( lying )?.height ?? 1 ).toBe( recipe.shape.height );
		// A clamped action rests one step short of the clip's end.
		expect( quarterTurns( lying ) ).toBeCloseTo( 1 - 1 / 120, 4 );

		const standing = await poser.still( { gender: 'female', appearanceSeed: seed }, 'Death01', 0 );
		expect( quarterTurns( standing ) ).toBeCloseTo( 0, 5 );
		const halfway = await poser.still( { gender: 'female', appearanceSeed: seed }, 'Death01', 0.5 );
		expect( quarterTurns( halfway ) ).toBeCloseTo( ( 1 - 1 / 120 ) / 2, 2 );
		// Bodies at once wear dressed sets of their own of the one body, and one fit.
		expect( loaded ).toEqual( [ recipe.body ] );
		expect( new Set( [ lying, standing, halfway ].map( ( root ) => root.userData.dressed ) ).size ).toBe( 3 );
		const fit = poser.fit( lying );
		expect( fit.users ).toBe( 3 );

		const set = lying.userData.dressed;
		poser.release( lying );
		expect( set.worn ).toBe( false );
		expect( lying.userData.dressed ).toBeNull();
		expect( fit.users ).toBe( 2 );
		expect( poser.height( lying ) ).toBeNull();
		await expect( poser.still( { gender: 'male', appearanceSeed: 3 }, 'Death99', 1 ) ).rejects.toThrow( 'missing Death99' );

	} );

	it( 'shares the focused rig\'s bodies, so the bodies prepared at load are the ones a still wears', async () => {

		const loaded = [];
		const hero = new HeroCharacter( heroRigs( {
			animation: animation( {}, humanoid() ),
			loadModel: ( descriptor ) => {

				loaded.push( descriptor.id );
				return { scene: humanoid() };

			},
			loadHair: () => ( { scene: humanoid() } )
		} ) );
		await hero.prepare();
		const prepared = ( await hero.poser.bodies.get( 'regular-male' ) ).wardrobe[ 0 ];
		const still = await hero.poser.still( { gender: 'male', appearanceSeed: 3 }, 'Death01', 1 );
		expect( loaded ).toEqual( [ 'regular-male', 'regular-female' ] );
		expect( still.userData.dressed ).toBe( prepared );

	} );

} );

it( 'fades the focused eyes, skin, hair and garments through one render-group coverage', async () => {

	const poser = new CharacterPoser( {
		animation: animation( {}, humanoid() ), tailor: plainTailor(),
		loadModel: () => {

			const scene = humanoid();
			const body = scene.getObjectByName( 'body' );
			const eyes = new THREE.SkinnedMesh( body.geometry.clone(), new THREE.MeshStandardMaterial( { map: new THREE.Texture() } ) );
			eyes.name = 'Eyes';
			eyes.bind( body.skeleton );
			scene.add( eyes );
			return { scene };

		},
		loadHair: () => ( { scene: humanoid() } )
	} );
	const person = await poser.still( { gender: 'female', appearanceSeed: 123 }, 'Death01', 0 );
	const dressed = person.userData.dressed;
	dressed.presence.value = 0;
	const meshes = [];
	person.traverse( ( node ) => { if ( node.isMesh ) meshes.push( node ); } );
	expect( meshes.find( ( mesh ) => mesh.name === 'Eyes' ).material ).toBe( [ ...dressed.eyes.values() ][ 0 ] );
	for ( const mesh of meshes ) {

		expect( mesh.material.maskNode ).toBeTruthy();
		expect( mesh.material.maskShadowNode ).toBe( mesh.material.maskNode );

	}
	expect( dressed.presence.groupNode.name ).toBe( 'render' );

} );

describe.skipIf( ! SOURCE_PRESENT )( 'the Source people', () => {

	it( 'dresses a person in fitted garments on the body\'s skeleton over skin they hide, at their height, and hands everything back on release', async () => {

		const animation = await animationLibrary();
		const poser = new CharacterPoser( { animation, ...sourceLoaders } );
		const recipe = personRecipe( { gender: 'male', appearanceSeed: 3141592653 } );
		const source = await poser.model( recipe );
		const root = poser.dress( source, { position: new THREE.Vector3( 2, 0, 3 ), heading: 1 }, 'person' );
		const meshes = [];
		root.traverse( ( node ) => { if ( node.isMesh ) meshes.push( node ); } );
		const body = meshes.find( ( mesh ) => mesh.material === root.userData.dressed.skin );
		expect( body.geometry ).toBe( source.fit.body );
		expect( source.fit.hidden ).toBeGreaterThan( 1000 );
		const garments = meshes.filter( ( mesh ) => mesh.userData.garment );
		expect( garments.map( ( mesh ) => mesh.userData.garment.id ) ).toEqual( SLOTS.map( ( slot ) => recipe.outfit[ slot ] ) );
		expect( garments.every( ( mesh ) => mesh.skeleton === body.skeleton ) ).toBe( true );
		expect( meshes.some( ( mesh ) => mesh.userData.hair && mesh.parent.name === 'Head' && mesh.name !== 'Eyebrows' ) ).toBe( true );

		// Walking, the shells stay on the body: every skinned garment vertex is near it.
		const mixer = new THREE.AnimationMixer( root );
		mixer.clipAction( source.motions.clip( THREE.AnimationClip.findByName( animation.animations, 'Walk_Loop' ) ) ).play();
		const height = poser.height( root );
		height?.beforePose();
		mixer.update( 0.4 );
		height?.afterPose();
		root.updateMatrixWorld( true );
		const point = new THREE.Vector3();
		for ( const mesh of garments ) {

			for ( let vertex = 0; vertex < mesh.geometry.getAttribute( 'position' ).count; vertex += 53 ) {

				mesh.getVertexPosition( vertex, point ).applyMatrix4( mesh.matrixWorld );
				expect( point.distanceTo( root.position ) ).toBeLessThan( 2.2 );

			}

		}

		const fit = source.fit;
		const dressed = root.userData.dressed;
		poser.release( root );
		expect( fit.users ).toBe( 0 );
		expect( dressed.worn ).toBe( false );
		// Worn again, the same fit comes back with nothing built.
		const again = await poser.model( recipe );
		expect( again.fit ).toBe( fit );
		expect( poser.tailor.built ).toBe( 1 );
		poser.drop( again );
		expect( fit.users ).toBe( 0 );

	}, 30000 );

} );

function quarterTurns( root ) {

	let bone = null;
	root.traverse( ( node ) => { if ( node.isBone && node.name === 'root' && ! bone ) bone = node; } );
	return 2 * Math.acos( Math.min( 1, Math.abs( bone.quaternion.w ) ) ) / ( Math.PI / 2 );

}
