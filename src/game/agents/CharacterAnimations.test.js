import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { CharacterAnimations } from './CharacterAnimations.js';
import { FRAMES, VatBaker } from './VatBaker.js';

describe( 'Source character motion', () => {

	it( 'keeps body proportions and source assets while transferring the full motion into baked and live poses', () => {

		const target = rig( 1.2, 0.6 );
		const source = rig( 1, 0.4 );
		const turn = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 0, 0, 1 ), Math.PI / 3 );
		const original = new THREE.AnimationClip( 'Walk_Loop', 1, [
			new THREE.VectorKeyframeTrack( 'root.position', [ 0, 1 ], [ 0, 0, 0, 0, 0, 4 ] ),
			new THREE.VectorKeyframeTrack( 'pelvis.position', [ 0, 0.5, 1 ], [ 0, 1, 0, 0, 0.8, 0, 0, 1, 0 ] ),
			new THREE.VectorKeyframeTrack( 'calf_l.position', [ 0, 1 ], [ 0, - 0.4, 0, 0, - 0.4, 0 ] ),
			new THREE.QuaternionKeyframeTrack( 'calf_l.quaternion', [ 0, 0.5, 1 ], [
				0, 0, 0, 1, ...turn.toArray(), 0, 0, 0, 1
			] )
		] );
		const originalBytes = JSON.stringify( original.toJSON() );
		const motions = new CharacterAnimations( target.root, source.root );
		const clip = motions.clip( original );
		expect( motions.clip( original ) ).toBe( clip );
		expect( clip.duration ).toBe( original.duration );
		expect( JSON.stringify( original.toJSON() ) ).toBe( originalBytes );
		expect( source.calf.position.y ).toBe( - 0.4 );
		expect( target.calf.position.y ).toBe( - 0.6 );
		expect( target.pelvis.position.y ).toBe( 1.2 );

		const [ baked ] = VatBaker.bake( target.root, [ target.mesh ], [ clip ] );
		const mixer = new THREE.AnimationMixer( target.root );
		mixer.clipAction( clip ).play();
		const vertex = new THREE.Vector3();
		for ( let frame = 0; frame < FRAMES; frame ++ ) {

			mixer.setTime( frame / FRAMES );
			target.root.updateMatrixWorld( true );
			expect( target.calf.position.y ).toBe( - 0.6 );
			expect( target.mesh.skeleton.getBoneByName( 'root' ).position.length() ).toBe( 0 );
			target.mesh.getVertexPosition( 0, vertex );
			expect( vertex.distanceTo( new THREE.Vector3().fromArray( baked.position, frame * 4 ) ) ).toBeLessThan( 1e-6 );

		}
		mixer.setTime( 0.5 );
		expect( target.pelvis.position.y ).toBeCloseTo( 0.96, 2 );
		expect( target.calf.quaternion.angleTo( turn ) ).toBeLessThan( 0.04 );

	} );

	it.each( [
		[ '24 Hz motion', 1, 24 ],
		[ 'a short one-shot', 1 / 60, 2 ]
	] )( 'retains authored keys and the final pose for %s', ( name, duration, intervals ) => {

		const target = rig( 1.2, 0.6 );
		const source = rig( 1, 0.4 );
		const times = Array.from( { length: intervals + 1 }, ( _, index ) => index * duration / intervals );
		const positions = times.flatMap( ( _, index ) => [ 0, index % 2 ? 0.8 : 1, 0 ] );
		const original = new THREE.AnimationClip( name, duration, [
			new THREE.VectorKeyframeTrack( 'pelvis.position', times, positions )
		] );
		const clip = new CharacterAnimations( target.root, source.root ).clip( original );
		const mixer = new THREE.AnimationMixer( target.root );
		const action = mixer.clipAction( clip ).setLoop( THREE.LoopOnce, 1 );
		action.clampWhenFinished = true;
		action.play();
		for ( let index = 0; index < times.length; index ++ ) {

			mixer.setTime( times[ index ] );
			expect( target.pelvis.position.y ).toBeCloseTo( positions[ index * 3 + 1 ] * 1.2, 4 );

		}

	} );

} );

function rig( hipHeight, legLength ) {

	const root = new THREE.Group();
	const bone = new THREE.Bone();
	bone.name = 'root';
	const pelvis = new THREE.Bone();
	pelvis.name = 'pelvis';
	pelvis.position.y = hipHeight;
	const calf = new THREE.Bone();
	calf.name = 'calf_l';
	calf.position.y = - legLength;
	bone.add( pelvis );
	pelvis.add( calf );
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [ 0.1, hipHeight - legLength, 0 ], 3 ) );
	geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( [ 1, 0, 0 ], 3 ) );
	geometry.setAttribute( 'skinIndex', new THREE.Uint16BufferAttribute( [ 2, 0, 0, 0 ], 4 ) );
	geometry.setAttribute( 'skinWeight', new THREE.Float32BufferAttribute( [ 1, 0, 0, 0 ], 4 ) );
	const mesh = new THREE.SkinnedMesh( geometry, new THREE.MeshBasicMaterial() );
	mesh.add( bone );
	mesh.bind( new THREE.Skeleton( [ bone, pelvis, calf ] ) );
	root.add( mesh );
	root.updateMatrixWorld( true );
	return { root, mesh, pelvis, calf };

}
