import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { NodeSampledTexture } from 'three/src/renderers/common/nodes/NodeSampledTexture.js';
import { ActorLighting } from './ActorLighting.js';
import { roomFillValue } from './RoomFillNode.js';
import { FillChannel } from '../city/kit/FillChannel.js';

/** Retain one built graph's sampled bindings while its rendered object changes. */
function graphFor( mesh ) {

	const textures = new Set(), sizes = new Set();
	roomFillValue( mesh, {} ).traverse( ( node ) => {

		if ( node.isTextureNode ) textures.add( node );
		if ( node.isTextureSizeNode ) sizes.add( node );

	} );
	const bindings = [ ...textures ].map( ( node ) => new NodeSampledTexture( 'fill', node, node.groupNode ) );
	const frame = new THREE.NodeFrame();
	return {
		sizes,
		draw( object ) {

			frame.object = object;
			for ( const node of textures ) {

				// Texel-only TextureNode setup can disable its ordinary update.
				node.updateType = 'none';
				frame.updateNode( node );

			}
			for ( const binding of bindings ) binding.update();
			return bindings.map( ( binding ) => binding.texture );

		}
	};

}

describe( 'room fill texture bindings', () => {

	it( 'rebinds a cached focused material to the current root after the previous channel is released', () => {

		const lighting = new ActorLighting( { spots: [], strips: [] }, () => [] );
		const source = new THREE.MeshStandardMaterial();
		const geometry = new THREE.BoxGeometry();
		const root = () => new THREE.Group().add( new THREE.Mesh( geometry, source ) );
		const first = root(), second = root();
		lighting.attachRoot( first, new THREE.Vector3() );
		first.userData.actorFill.set( 0, new THREE.Vector4( 12, 8, 4, 0.3 ) );
		const graph = graphFor( first.children[ 0 ] );
		const oldTexture = first.userData.actorFill.texture;
		expect( graph.draw( first.children[ 0 ] ).every( ( texture ) => texture === oldTexture ) ).toBe( true );

		lighting.releaseRoot( first );
		lighting.attachRoot( second, new THREE.Vector3() );
		second.userData.actorFill.set( 0, new THREE.Vector4( 4, 10, 20, 0.5 ) );
		expect( second.children[ 0 ].material ).toBe( first.children[ 0 ].material );
		const rebound = graph.draw( second.children[ 0 ] );
		expect( rebound.length ).toBeGreaterThan( 0 );
		for ( const texture of rebound ) {

			expect( texture ).toBe( second.userData.actorFill.texture );
			expect( texture ).not.toBe( oldTexture );
			expect( Array.from( texture.image.data ) ).toEqual( [ 4, 10, 20, 0.5 ] );

		}
		// A keeper with the same material but no channel receives no room fill.
		for ( const texture of graph.draw( new THREE.Mesh( geometry, second.children[ 0 ].material ) ) ) {

			expect( Array.from( texture.image.data ) ).toEqual( [ 0, 0, 0, 0 ] );

		}
		lighting.releaseRoot( second );
		second.children[ 0 ].material.dispose();
		source.dispose();
		geometry.dispose();

	} );

	it( 'uses the grown channel for both texel loads and texture dimensions without rebuilding the graph', () => {

		const mesh = new THREE.Mesh( new THREE.InstancedBufferGeometry(), new THREE.MeshStandardNodeMaterial() );
		const channel = new FillChannel( 1 ).attach( mesh );
		channel.set( 0, new THREE.Vector4( 3, 6, 9, 0.25 ) );
		const graph = graphFor( mesh );
		const previous = channel.texture;
		graph.draw( mesh );
		channel.grow( 9 );
		channel.set( 8, new THREE.Vector4( 8, 16, 24, 0.5 ) );

		for ( const texture of graph.draw( mesh ) ) {

			expect( texture ).toBe( channel.texture );
			expect( texture ).not.toBe( previous );
			expect( Array.from( texture.image.data.slice( 0, 4 ) ) ).toEqual( [ 3, 6, 9, 0.25 ] );
			expect( Array.from( texture.image.data.slice( 32, 36 ) ) ).toEqual( [ 8, 16, 24, 0.5 ] );

		}
		expect( graph.sizes.size ).toBeGreaterThan( 0 );
		for ( const size of graph.sizes ) {

			expect( size.textureNode.value ).toBe( channel.texture );
			expect( size.textureNode.value.image.width ).toBe( 3 );

		}
		channel.dispose();
		mesh.geometry.dispose();
		mesh.material.dispose();

	} );

} );
