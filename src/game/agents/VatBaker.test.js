import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { FRAMES, VatBaker } from './VatBaker.js';
import { CharacterAnimations } from './CharacterAnimations.js';
import { characterParts, headParts } from './CharacterAssets.js';
import { EVERYONE, crowdHairstyles } from './HairMesh.js';
import { SOURCE_PRESENT, animationLibrary, sourceGltf } from './avatar/SourceAssets.test-fixtures.js';

describe( 'VAT surface normals', () => {

	it( 'skins the authored normals instead of deriving faceted triangle normals, one row per ask of the frame budget', async () => {

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [
			0, 0, 0, 1, 0, 0, 0, 1, 0
		], 3 ) );
		geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( [
			1, 0, 0, 1, 0, 0, 1, 0, 0
		], 3 ) );
		geometry.setAttribute( 'skinIndex', new THREE.Uint16BufferAttribute( [
			0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
		], 4 ) );
		geometry.setAttribute( 'skinWeight', new THREE.Float32BufferAttribute( [
			1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0
		], 4 ) );

		const bone = new THREE.Bone();
		const mesh = new THREE.SkinnedMesh( geometry, new THREE.MeshBasicMaterial() );
		mesh.add( bone );
		mesh.bind( new THREE.Skeleton( [ bone ] ) );

		const root = new THREE.Group();
		root.add( mesh );
		let asked = 0;
		const slice = { step: async () => { asked ++; } };
		const [ baked ] = await VatBaker.bake( root, [ mesh ], [ new THREE.AnimationClip( 'idle', 1, [] ) ], slice );

		expect( asked ).toBe( FRAMES );

		for ( let row = 0; row < FRAMES; row ++ ) {

			for ( let vertex = 0; vertex < 3; vertex ++ ) {

				const offset = ( row * 3 + vertex ) * 4;
				expect( Array.from( baked.normal.slice( offset, offset + 3 ) ) ).toEqual( [ 1, 0, 0 ] );

			}

		}

	} );

} );

describe( 'VAT skinning', () => {

	/** Two bones, the child turning and lifting over the clip, and a bind matrix that is not the identity. */
	const rig = () => {

		const geometry = new THREE.CylinderGeometry( 0.2, 0.3, 2, 8, 4 );
		const position = geometry.getAttribute( 'position' );
		const joints = [], weights = [];
		for ( let i = 0; i < position.count; i ++ ) {

			const up = THREE.MathUtils.clamp( ( position.getY( i ) + 1 ) / 2, 0, 1 );
			joints.push( 0, 1, 0, 0 );
			weights.push( 1 - up, up, 0, 0 );

		}
		geometry.setAttribute( 'skinIndex', new THREE.Uint16BufferAttribute( joints, 4 ) );
		geometry.setAttribute( 'skinWeight', new THREE.Float32BufferAttribute( weights, 4 ) );

		const hip = new THREE.Bone();
		const knee = new THREE.Bone();
		hip.name = 'hip';
		knee.name = 'knee';
		knee.position.y = 1;
		hip.add( knee );
		const mesh = new THREE.SkinnedMesh( geometry, new THREE.MeshBasicMaterial() );
		const root = new THREE.Group();
		root.position.set( 1, 0, - 2 );
		mesh.position.set( 0, 0.5, 0 );
		mesh.rotation.y = 0.4;
		root.add( hip, mesh );
		root.updateMatrixWorld( true );
		mesh.bind( new THREE.Skeleton( [ hip, knee ] ) );

		const turn = new THREE.QuaternionKeyframeTrack( 'knee.quaternion', [ 0, 1 ], [
			...new THREE.Quaternion().toArray(),
			...new THREE.Quaternion().setFromEuler( new THREE.Euler( 0.9, 0.2, - 0.5 ) ).toArray()
		] );
		const lift = new THREE.VectorKeyframeTrack( 'hip.position', [ 0, 1 ], [ 0, 0, 0, 0.3, 0.4, - 0.2 ] );

		return { root, mesh, clips: [ new THREE.AnimationClip( 'bend', 1, [ turn, lift ] ), new THREE.AnimationClip( 'lift', 2, [ lift ] ) ] };

	};

	/** What three itself makes of every row: its skinned position, and the blend applied to the authored normal. */
	const reference = ( root, mesh, clips ) => {

		const mixer = new THREE.AnimationMixer( root );
		const count = mesh.geometry.getAttribute( 'position' ).count;
		const rows = clips.length * FRAMES;
		const position = new Float32Array( count * rows * 4 ), normal = new Float32Array( count * rows * 4 );
		const v = new THREE.Vector3(), n = new THREE.Vector3(), skin = new THREE.Matrix4(), bound = new THREE.Matrix4();
		const joints = mesh.geometry.getAttribute( 'skinIndex' ), weights = mesh.geometry.getAttribute( 'skinWeight' );

		clips.forEach( ( clip, c ) => {

			mixer.stopAllAction();
			mixer.clipAction( clip ).reset().play();
			for ( let f = 0; f < FRAMES; f ++ ) {

				mixer.setTime( ( f / FRAMES ) * clip.duration );
				root.updateMatrixWorld( true );
				mesh.skeleton.update();
				const stride = ( c * FRAMES + f ) * count * 4;
				for ( let i = 0; i < count; i ++ ) {

					mesh.getVertexPosition( i, v ).toArray( position, stride + i * 4 );
					skin.elements.fill( 0 );
					for ( let slot = 0; slot < 4; slot ++ ) {

						for ( let e = 0; e < 16; e ++ ) skin.elements[ e ] += mesh.skeleton.boneMatrices[ joints.getComponent( i, slot ) * 16 + e ] * weights.getComponent( i, slot );

					}
					bound.multiplyMatrices( mesh.bindMatrixInverse, skin ).multiply( mesh.bindMatrix );
					n.fromBufferAttribute( mesh.geometry.getAttribute( 'normal' ), i ).transformDirection( bound ).toArray( normal, stride + i * 4 );

				}

			}

		} );
		mixer.stopAllAction();

		return { position, normal };

	};

	const largestDifference = ( a, b ) => a.reduce( ( worst, value, i ) => Math.max( worst, Math.abs( value - b[ i ] ) ), 0 );

	it( 'skins every row as three skins it, a row per ask of the frame budget', async () => {

		const { root, mesh, clips } = rig();
		const expected = reference( root, mesh, clips );
		let asked = 0;
		const [ baked ] = await VatBaker.bake( root, [ mesh ], clips, { step: async () => { asked ++; } } );

		expect( asked ).toBe( clips.length * FRAMES );
		expect( baked.rows ).toBe( clips.length * FRAMES );
		expect( largestDifference( baked.position, expected.position ) ).toBeLessThan( 1e-5 );
		expect( largestDifference( baked.normal, expected.normal ) ).toBeLessThan( 1e-5 );
		// The rig moves: a row late in the bend is not its first.
		const row = 4 * baked.vertexCount;
		expect( largestDifference( baked.position.subarray( 0, row ), baked.position.subarray( 20 * row, 21 * row ) ) ).toBeGreaterThan( 0.1 );

	} );

} );

describe.skipIf( ! SOURCE_PRESENT )( 'the crowd\'s rigid head parts', () => {

	it( 'carries the eyebrows and every hairstyle on the baked Head bone where their skin would put them, one matrix a frame', async () => {

		const [ animation, model, mohawk ] = await Promise.all( [
			animationLibrary(), sourceGltf( 'Regular_Male_FullBody.gltf' ), sourceGltf( 'Hairstyles/Rigged to Head Bone/Male/Hair_Mohawk.gltf' )
		] );
		const { body, eyebrows } = characterParts( model.scene );
		const motions = new CharacterAnimations( model.scene, animation.scene );
		const clips = [ 'Walk_Loop', 'Idle_Talking_Loop' ].map( ( name ) => motions.clip( THREE.AnimationClip.findByName( animation.animations, name ) ) );
		const head = await VatBaker.bakeJoint( model.scene, body, 'Head', clips );
		expect( head.rows ).toBe( clips.length * FRAMES );
		expect( head.data.length ).toBe( head.rows * 12 );
		const [ brows ] = await VatBaker.bake( model.scene, [ eyebrows ], clips );
		const parts = headParts( [ { mesh: eyebrows, style: EVERYONE }, { mesh: mohawk.scene.getObjectByProperty( 'isSkinnedMesh', true ), style: 3 } ] );
		const local = parts.getAttribute( 'position' );
		const part = parts.getAttribute( 'hairPart' );
		expect( [ part.getX( 0 ), part.getY( 0 ) ] ).toEqual( [ EVERYONE, 0 ] );
		expect( [ part.getX( local.count - 1 ), part.getY( local.count - 1 ) ] ).toEqual( [ 3, 0 ] );
		// Carried by the baked Head, each brow vertex lands where the brow's own skinning bakes it.
		const carried = new THREE.Vector3();
		for ( const row of [ 0, 9, FRAMES + 17 ] ) {

			const matrix = new THREE.Matrix4();
			const rows = head.data.subarray( row * 12, row * 12 + 12 );
			matrix.set( ...rows.slice( 0, 4 ), ...rows.slice( 4, 8 ), ...rows.slice( 8, 12 ), 0, 0, 0, 1 );
			for ( let vertex = 0; vertex < brows.vertexCount; vertex += 29 ) {

				carried.fromBufferAttribute( local, vertex ).applyMatrix4( matrix );
				const baked = brows.position.subarray( ( row * brows.vertexCount + vertex ) * 4, ( row * brows.vertexCount + vertex ) * 4 + 3 );
				expect( carried.distanceTo( new THREE.Vector3( ...baked ) ) ).toBeLessThan( 1e-4 );

			}

		}

	} );

	it( 'numbers a gender\'s hairstyles for its merged hair, a teen style as its adult one and anything else as none', () => {

		const male = crowdHairstyles( 'male' );
		expect( male.paths ).toHaveLength( 10 );
		expect( male.index( 'Hairstyles/Rigged to Head Bone/Male/Hair_Mohawk.gltf' ) ).toBe( 3 );
		expect( male.index( 'Hairstyles/Rigged to Head Bone/Male/Hair_Mohawk_Teen.gltf' ) ).toBe( 3 );
		expect( male.index( 'Hairstyles/Rigged to Head Bone/Male/Hair_Beard.gltf' ) ).toBe( 7 );
		expect( male.index( '' ) ).toBeLessThan( EVERYONE );
		expect( male.index( 'Hairstyles/Rigged to Head Bone/Female/Hair_Bob.gltf' ) ).toBeLessThan( EVERYONE );
		expect( crowdHairstyles( 'female' ).paths ).toHaveLength( 6 );

	} );

} );
