import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { vec3 } from 'three/tsl';
import { ActorLighting } from './ActorLighting.js';
import { Room } from '../city/InteriorRooms.js';
import { FillChannel } from '../city/kit/FillChannel.js';
import { RoomLights } from './RoomLights.js';

function room( elevation, fill ) {

	const result = new Room( {
		floor: { id: `p1:${elevation}`, parcelId: 'p1', floor: elevation / 4, elevation, height: 3.8 },
		room: { id: 'lobby', kind: 'lobby', polygon: [ [ 0, 0 ], [ 6, 0 ], [ 6, 6 ], [ 0, 6 ] ], holes: [ [ [ 2, 2 ], [ 3, 2 ], [ 3, 3 ], [ 2, 3 ] ] ] },
		fixtures: [], surfaces: []
	} );
	result.fill = new THREE.Vector4( ...fill );
	return result;

}

describe( 'moving actors in lit rooms', () => {

	it( 'writes each instanced body and hair slot from its own room, clears outdoors and keeps core holes and storeys separate', () => {

		let rooms = [ room( 0, [ 20, 14, 8, 0.4 ] ), room( 4, [ 9, 12, 22, 0.3 ] ) ];
		const lighting = new ActorLighting( { spots: [], strips: [] }, () => rooms );
		const body = new THREE.Mesh( new THREE.InstancedBufferGeometry(), new THREE.MeshStandardNodeMaterial() );
		const hair = new THREE.Mesh( new THREE.InstancedBufferGeometry(), new THREE.MeshStandardNodeMaterial() );
		const attributes = Object.keys( body.geometry.attributes );
		lighting.attach( body, 3 );
		lighting.attach( hair, 3 );
		for ( const mesh of [ body, hair ] ) {

			lighting.write( mesh, 0, lighting.fillAt( new THREE.Vector3( 1, 0, 1 ) ) );
			lighting.write( mesh, 1, lighting.fillAt( new THREE.Vector3( 1, 4, 1 ) ) );
			lighting.write( mesh, 2, lighting.fillAt( new THREE.Vector3( 2.5, 0, 2.5 ) ) );
			const data = FillChannel.of( mesh ).texture.image.data;
			expect( Array.from( data.slice( 0, 3 ) ) ).toEqual( [ 20, 14, 8 ] );
			expect( Array.from( data.slice( 4, 7 ) ) ).toEqual( [ 9, 12, 22 ] );
			expect( Array.from( data.slice( 8, 12 ) ) ).toEqual( [ 0, 0, 0, 0 ] );
			lighting.write( mesh, 0, lighting.fillAt( new THREE.Vector3( - 1, 0, 1 ) ) );
			expect( Array.from( data.slice( 0, 4 ) ) ).toEqual( [ 0, 0, 0, 0 ] );

		}
		expect( Object.keys( body.geometry.attributes ) ).toEqual( attributes );
		rooms = [];
		expect( lighting.fillAt( new THREE.Vector3( 1, 4, 1 ) ).toArray() ).toEqual( [ 0, 0, 0, 0 ] );

	} );

	it( 'preserves the original actor maps, pose, garments and scene lighting while sharing the actual room fixture sources', () => {

		const roomLights = new RoomLights( {}, { roomSlots: 1, roomSpots: 2, roomStrips: 1 } );
		const lighting = new ActorLighting( roomLights, () => [] );
		const source = new THREE.MeshStandardNodeMaterial( { map: new THREE.Texture(), normalMap: new THREE.Texture(), roughness: 0.73, alphaTest: 0.4 } );
		source.positionNode = vec3( 1, 2, 3 );
		source.normalNode = vec3( 0, 1, 0 );
		source.colorNode = vec3( 0.3, 0.6, 0.9 );
		const material = lighting.materialFor( source );
		expect( lighting.materialFor( source ) ).toBe( material );
		expect( material.map ).toBe( source.map );
		expect( material.normalMap ).toBe( source.normalMap );
		expect( material.roughness ).toBe( source.roughness );
		expect( material.alphaTest ).toBe( source.alphaTest );
		expect( material.positionNode ).toBe( source.positionNode );
		expect( material.normalNode ).toBe( source.normalNode );
		expect( material.colorNode ).toBe( source.colorNode );
		expect( material.lightsNode ).toBeNull();
		expect( source.actorRoomNode ).toBeUndefined();
		expect( lighting.node.fixtures.map( ( node ) => node.light ) ).toEqual( [ ...roomLights.spots, ...roomLights.strips ] );
		const fixture = roomLights.spots[ 0 ];
		fixture.intensity = 732;
		fixture.color.setRGB( 1, 0.8, 0.6 );
		expect( lighting.node.fixtures[ 0 ].light.intensity ).toBe( 732 );
		expect( lighting.node.fixtures[ 0 ].light.color ).toBe( fixture.color );

	} );

	it( 'shares one fill texel across a focused body and hair, updates as it moves, and releases the departed root', () => {

		const lighting = new ActorLighting( { spots: [], strips: [] }, () => [ room( 0, [ 20, 14, 8, 0.4 ] ) ] );
		const root = new THREE.Group();
		const source = new THREE.MeshStandardMaterial( { map: new THREE.Texture() } );
		root.add( new THREE.Mesh( new THREE.BoxGeometry(), source ), new THREE.Mesh( new THREE.BoxGeometry(), source ) );
		lighting.attachRoot( root, new THREE.Vector3( 1, 0, 1 ) );
		const channel = FillChannel.of( root.children[ 0 ] );
		expect( FillChannel.of( root.children[ 1 ] ) ).toBe( channel );
		expect( Array.from( channel.texture.image.data.slice( 0, 3 ) ) ).toEqual( [ 20, 14, 8 ] );
		expect( root.children[ 0 ].material.map ).toBe( source.map );
		lighting.writeRoot( root, new THREE.Vector3( - 1, 0, 1 ) );
		expect( Array.from( channel.texture.image.data ) ).toEqual( [ 0, 0, 0, 0 ] );
		const dispose = vi.spyOn( channel.texture, 'dispose' );
		lighting.releaseRoot( root );
		expect( dispose ).toHaveBeenCalledOnce();
		expect( FillChannel.of( root.children[ 0 ] ) ).toBeNull();
		expect( root.userData.actorFill ).toBeUndefined();

	} );

} );
