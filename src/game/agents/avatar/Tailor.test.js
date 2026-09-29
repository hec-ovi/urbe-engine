import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { Tailor, fitKey } from './Tailor.js';
import { bodyOf } from './BodyShape.js';
import { HeightRig } from './HeightRig.js';
import { stepped, whole } from './Steps.js';
import { fitOutfit } from './Wardrobe.js';
import { TOPS } from './Tops.js';
import { FOOTWEAR, PANTS } from './Lower.js';
import { GARMENTS, SLOTS, defaultRecipe, personRecipe } from './Recipe.js';
import { SOURCE_PRESENT, sourceGltf } from './SourceAssets.test-fixtures.js';

describe( 'garment patterns', () => {

	it( 'cut every garment a recipe can name, one pattern each', () => {

		expect( TOPS.map( ( pattern ) => pattern.id ) ).toEqual( GARMENTS.top );
		expect( PANTS.map( ( pattern ) => pattern.id ) ).toEqual( GARMENTS.pants );
		expect( FOOTWEAR.map( ( pattern ) => pattern.id ) ).toEqual( GARMENTS.footwear );

	} );

	it( 'keys a fit by body, surface shape and garments, never by colour or height', () => {

		const recipe = defaultRecipe( 'regular-female' );
		const recoloured = { ...recipe, colors: { ...recipe.colors, skin: '#4b3026' }, shape: { ...recipe.shape, height: 1.05 } };
		expect( fitKey( recoloured ) ).toBe( fitKey( recipe ) );
		expect( fitKey( { ...recipe, shape: { ...recipe.shape, hips: 1.1 } } ) ).not.toBe( fitKey( recipe ) );
		expect( fitKey( { ...recipe, outfit: { ...recipe.outfit, top: 'top-tee' } } ) ).not.toBe( fitKey( recipe ) );
		expect( fitKey( { ...recipe, body: 'teen-female', hair: 'Hairstyles/Rigged to Head Bone/Female/Hair_Bob_Teen.gltf' } ) ).not.toBe( fitKey( recipe ) );

	} );

	it( 'hands the frame back between steps under a budget, and runs through without one', async () => {

		const steps = function* () {

			yield;
			yield;
			return 'done';

		};
		const slice = { step: vi.fn().mockResolvedValue() };
		expect( await stepped( steps(), slice ) ).toBe( 'done' );
		expect( slice.step ).toHaveBeenCalledTimes( 2 );
		expect( whole( steps() ) ).toBe( 'done' );

	} );

} );

describe.skipIf( ! SOURCE_PRESENT )( 'tailoring the Source bodies', () => {

	const body = async ( file ) => {

		const model = await sourceGltf( file );
		model.descriptor = { id: file };
		return model;

	};

	it( 'refines a body once and fits a person\'s garments as shells on its own skeleton, covering what they hide', async () => {

		const model = await body( 'Regular_Female_FullBody.gltf' );
		const source = bodyOf( model.scene ).geometry;
		const tailor = new Tailor();
		const shapes = await tailor.prepare( model );
		expect( await tailor.prepare( model ) ).toBe( shapes );
		const refined = bodyOf( model.scene ).geometry;
		expect( refined ).not.toBe( source );
		expect( refined.userData.seatSurface.originalVertices ).toBe( source.getAttribute( 'position' ).count );
		expect( refined.getAttribute( 'position' ).count ).toBeGreaterThan( source.getAttribute( 'position' ).count );
		// Every source vertex stays where and as it was.
		expect( Array.from( refined.getAttribute( 'position' ).array.slice( 0, 300 ) ) ).toEqual( Array.from( source.getAttribute( 'position' ).array.slice( 0, 300 ) ) );

		const recipe = personRecipe( { gender: 'female', appearanceSeed: 3141592653 } );
		const fit = await tailor.fit( model, recipe );
		expect( fit.users ).toBe( 1 );
		expect( fit.garments.map( ( garment ) => [ garment.slot, garment.id ] ) ).toEqual( SLOTS.map( ( slot ) => [ slot, recipe.outfit[ slot ] ] ) );
		expect( fit.hidden ).toBeGreaterThan( 1000 );
		expect( fit.body.index.count / 3 + fit.hidden ).toBe( refined.index.count / 3 );
		const joints = refined.getAttribute( 'skinIndex' );
		const weights = refined.getAttribute( 'skinWeight' );
		for ( const { geometry } of fit.garments ) {

			// Seven vertex buffers: WebGPU draws a skinned garment within its eight.
			expect( Object.keys( geometry.attributes ).sort() ).toEqual( [ 'garmentNormal', 'garmentShares', 'garmentSurface', 'normal', 'position', 'skinIndex', 'skinWeight' ] );
			const sources = geometry.userData.sources;
			for ( let vertex = 0; vertex < sources.length; vertex += 37 ) {

				if ( sources[ vertex ] < 0 ) continue;
				for ( let slot = 0; slot < 4; slot ++ ) {

					expect( geometry.getAttribute( 'skinIndex' ).getComponent( vertex, slot ) ).toBe( joints.getComponent( sources[ vertex ], slot ) );
					expect( geometry.getAttribute( 'skinWeight' ).getComponent( vertex, slot ) ).toBeCloseTo( weights.getComponent( sources[ vertex ], slot ), 6 );

				}

			}
			const position = geometry.getAttribute( 'position' ).array;
			expect( position.every( Number.isFinite ) ).toBe( true );

		}
		// The face's eyes and brows are the person's own shaped copies.
		expect( [ ...fit.auxiliaries.keys() ].sort() ).toEqual( [ 'Eyebrows', 'Eyes' ] );

		// Asked again, the same fit; a recoloured, taller person is the same fit too.
		expect( await tailor.fit( model, { ...recipe, colors: { ...recipe.colors, hair: '#191a20' }, shape: { ...recipe.shape, height: 1.06 } } ) ).toBe( fit );
		expect( fit.users ).toBe( 2 );
		expect( tailor.built ).toBe( 1 );

	} );

	it( 'keeps the fits nobody holds only up to its capacity, disposing the least recently used', async () => {

		const model = await body( 'Regular_Male_FullBody.gltf' );
		const tailor = new Tailor( { capacity: 2 } );
		const recipes = [ 11, 22, 33 ].map( ( seed ) => personRecipe( { gender: 'male', appearanceSeed: seed } ) );
		const first = await tailor.fit( model, recipes[ 0 ] );
		const disposed = vi.spyOn( first.body, 'dispose' );
		const second = await tailor.fit( model, recipes[ 1 ] );
		const third = await tailor.fit( model, recipes[ 2 ] );
		// Every fit is held: none goes.
		expect( tailor.fits.size ).toBe( 3 );
		tailor.release( first );
		tailor.release( third );
		expect( disposed ).toHaveBeenCalledOnce();
		expect( first.disposed ).toBe( true );
		expect( [ ...tailor.fits.values() ] ).toEqual( [ second, third ] );
		tailor.release( second );
		tailor.clear();
		expect( tailor.fits.size ).toBe( 0 );
		expect( [ second, third ].every( ( fit ) => fit.disposed ) ).toBe( true );

	} );

	it( 'fits a bare slot as skin and hides nothing a garment does not cover', async () => {

		const model = await body( 'Regular_Male_FullBody.gltf' );
		const shapes = await new Tailor().prepare( model );
		const geometry = new THREE.BufferGeometry();
		const source = shapes.body.geometry;
		for ( const name of [ 'position', 'normal', 'skinIndex', 'skinWeight' ] ) geometry.setAttribute( name, source.getAttribute( name ) );
		geometry.setIndex( new THREE.BufferAttribute( shapes.index, 1 ) );
		const bones = shapes.body.skeleton.bones.map( ( bone ) => bone.name );
		const bare = whole( fitOutfit( geometry, bones, { top: 'none', pants: 'none', footwear: 'none' } ) );
		expect( bare ).toMatchObject( { hidden: 0, garments: [] } );
		expect( bare.index.length ).toBe( shapes.index.length );
		const shorts = whole( fitOutfit( geometry, bones, { top: 'top-tank', pants: 'pants-shorts', footwear: 'none' } ) );
		const trousers = whole( fitOutfit( geometry, bones, { top: 'top-tank', pants: 'pants-tech', footwear: 'none' } ) );
		expect( shorts.hidden ).toBeLessThan( trousers.hidden );

	} );

	it( 'shapes the body and face in rest space, and gives a neutral shape back as authored', async () => {

		const model = await body( 'Regular_Female_FullBody.gltf' );
		const shapes = await new Tailor().prepare( model );
		const neutral = shapes.shaped( defaultRecipe( 'regular-female' ).shape );
		expect( Array.from( neutral.position ) ).toEqual( Array.from( shapes.positions ) );
		expect( Array.from( neutral.normal ) ).toEqual( Array.from( shapes.normals ) );
		const wide = shapes.shaped( { ...defaultRecipe().shape, hips: 1.2, eyeSize: 1.15 } );
		let moved = 0;
		for ( let i = 0; i < wide.position.length; i ++ ) if ( wide.position[ i ] !== shapes.positions[ i ] ) moved ++;
		expect( moved ).toBeGreaterThan( 100 );
		expect( moved ).toBeLessThan( wide.position.length / 2 );
		const eyes = wide.auxiliaries.get( 'Eyes' );
		expect( Array.from( eyes.position ) ).not.toEqual( Array.from( model.scene.getObjectByName( 'Eyes' ).geometry.getAttribute( 'position' ).array ) );

	} );

	it( 'lengthens legs and torso for height, keeping the head\'s size, the feet down and the bones unscaled', async () => {

		const model = await body( 'Regular_Male_FullBody.gltf' );
		const root = model.scene;
		const head = root.getObjectByName( 'Head' );
		const foot = root.getObjectByName( 'foot_l' );
		const neck = root.getObjectByName( 'neck_01' );
		root.updateMatrixWorld( true );
		const at = ( bone ) => new THREE.Vector3().setFromMatrixPosition( bone.matrixWorld );
		const before = { head: at( head ), foot: at( foot ), headToNeck: at( head ).distanceTo( at( neck ) ) };
		const scales = [];
		root.traverse( ( node ) => { if ( node.isBone ) scales.push( node.scale.toArray() ); } );
		const rig = new HeightRig( root, 1.06 );
		expect( at( head ).y - before.head.y ).toBeGreaterThan( 0.05 );
		expect( at( foot ).y ).toBeCloseTo( before.foot.y, 4 );
		expect( at( head ).distanceTo( at( neck ) ) ).toBeCloseTo( before.headToNeck, 5 );
		const after = [];
		root.traverse( ( node ) => { if ( node.isBone ) after.push( node.scale.toArray() ); } );
		expect( after ).toEqual( scales );
		const inverses = bodyOf( root ).skeleton.boneInverses;
		rig.dispose();
		expect( at( head ).y ).toBeCloseTo( before.head.y, 5 );
		expect( bodyOf( root ).skeleton.boneInverses ).not.toBe( inverses );

	} );

} );
