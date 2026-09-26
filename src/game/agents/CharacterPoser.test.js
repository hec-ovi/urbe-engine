import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { CharacterPoser } from './CharacterPoser.js';
import { HeroCharacter } from './HeroCharacter.js';
import { look } from './Appearance.js';
import { animation, rig } from './HeroCharacter.test-fixtures.js';

describe( 'still bodies', () => {

	it( 'lays out the crowd person a gender and seed give, in their look, at the transferred final frame', async () => {

		const loaded = [];
		const poser = new CharacterPoser( {
			animation: animation(),
			loadModel: ( descriptor ) => { loaded.push( descriptor.id ); return { scene: rig( 'body', { eyebrows: true } ), hairs: [ { scene: rig( 'hair' ) } ] }; }
		} );
		const seed = 2754811393;
		const lying = await poser.still( { gender: 'female', appearanceSeed: seed }, 'Death01', 1 );
		expect( loaded ).toEqual( [ 'regular-female' ] );
		const worn = lying.userData.dressed.look;
		expect( [ worn.skin, worn.shirt, worn.trousers, worn.hair ].map( ( channel ) => channel.value.getHex() ) )
			.toEqual( [ 'skin', 'shirt', 'trousers', 'hair' ].map( ( channel ) => look( seed )[ channel ].getHex() ) );
		expect( [ worn.sleeve.value, worn.hem.value ] ).toEqual( [ look( seed ).sleeve, look( seed ).hem ] );
		const hairs = [];
		lying.traverse( ( node ) => { if ( node.isMesh && node.userData.hair ) hairs.push( node.name ); } );
		expect( hairs.sort() ).toEqual( [ 'Eyebrows', 'hair' ] );
		// A clamped action rests one step short of the clip's end.
		expect( quarterTurns( lying ) ).toBeCloseTo( 1 - 1 / 120, 4 );

		const standing = await poser.still( { gender: 'female', appearanceSeed: seed }, 'Death01', 0 );
		expect( quarterTurns( standing ) ).toBeCloseTo( 0, 5 );
		const halfway = await poser.still( { gender: 'female', appearanceSeed: seed }, 'Death01', 0.5 );
		expect( quarterTurns( halfway ) ).toBeCloseTo( ( 1 - 1 / 120 ) / 2, 2 );
		// Bodies at once wear dressed sets of their own of the one shape.
		expect( loaded ).toEqual( [ 'regular-female' ] );
		expect( new Set( [ lying, standing, halfway ].map( ( root ) => root.userData.dressed ) ).size ).toBe( 3 );

		const set = lying.userData.dressed;
		poser.release( lying );
		expect( set.worn ).toBe( false );
		expect( lying.userData.dressed ).toBeNull();
		await expect( poser.still( { gender: 'male', appearanceSeed: 3 }, 'Death99', 1 ) ).rejects.toThrow( 'missing Death99' );

	} );

	it( 'shares the focused rig shapes, so the shapes prepared at load are the ones a still wears', async () => {

		const loaded = [];
		const hero = new HeroCharacter( {
			animation: animation(),
			loadModel: ( descriptor ) => { loaded.push( descriptor.id ); return { scene: rig( 'body' ), hairs: [] }; }
		} );
		await hero.prepare();
		const prepared = ( await hero.poser.models.values().next().value ).wardrobe[ 0 ];
		const still = await hero.poser.still( { gender: 'male', appearanceSeed: 3 }, 'Death01', 1 );
		expect( loaded ).toEqual( [ 'regular-male', 'regular-female' ] );
		expect( still.userData.dressed ).toBe( prepared );

	} );

} );

function quarterTurns( root ) {

	let bone = null;
	root.traverse( ( node ) => { if ( node.isBone && node.name === 'root' && ! bone ) bone = node; } );
	return 2 * Math.acos( Math.min( 1, Math.abs( bone.quaternion.w ) ) ) / ( Math.PI / 2 );

}
