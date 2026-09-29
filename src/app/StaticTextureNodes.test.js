import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { NodeUpdateType, texture, uv } from 'three/tsl';
import { installStaticTextureNodes, neverFlips } from './StaticTextureNodes.js';

/** The builder three's WebGL2 backend hands a texture node: it flips. */
const webgl = { isFlipY: () => true };

/** A texture node set up the way TextureNode.setup leaves it on WebGL2. */
function built( map, { transformed = false } = {} ) {

	const node = texture( map );
	let coordinates = uv();
	if ( transformed ) coordinates = node.getTransformedUV( coordinates );
	node.setupUV( webgl, coordinates );
	node.updateType = ( node._matrixUniform !== null || node._flipYUniform !== null ) ? NodeUpdateType.OBJECT : NodeUpdateType.NONE;

	return node;

}

describe( 'texture nodes that can never flip', () => {

	it( 'still finds the private fields it reads in this three', () => {

		const node = texture( new THREE.Texture() );
		expect( node ).toHaveProperty( '_flipYUniform', null );
		expect( node ).toHaveProperty( '_matrixUniform', null );
		expect( built( new THREE.DataTexture() )._flipYUniform?.isNode ).toBe( true );

	} );

	it( 'asks no per-object update for a plain map with flipY off, and keeps three\'s for anything that may flip', () => {

		installStaticTextureNodes();
		installStaticTextureNodes();

		const plain = new THREE.Texture();
		plain.flipY = false;
		const target = new THREE.RenderTarget( 4, 4 );
		const flipped = new THREE.Texture();
		const depth = new THREE.DepthTexture( 4, 4 );
		depth.flipY = false;

		const staticNode = built( plain );
		staticNode._flipYUniform.value = true;
		expect( neverFlips( staticNode ) ).toBe( true );
		expect( staticNode.getUpdateType() ).toBe( NodeUpdateType.NONE );
		// The flag the shader reads is the one three's update would have written.
		expect( staticNode._flipYUniform.value ).toBe( false );
		expect( built( new THREE.DataTexture() ).getUpdateType() ).toBe( NodeUpdateType.NONE );

		expect( built( target.texture ).getUpdateType() ).toBe( NodeUpdateType.OBJECT );
		expect( built( flipped ).getUpdateType() ).toBe( NodeUpdateType.OBJECT );
		expect( built( depth ).getUpdateType() ).toBe( NodeUpdateType.OBJECT );
		expect( built( plain, { transformed: true } ).getUpdateType() ).toBe( NodeUpdateType.OBJECT );

		// WebGPU adds no flip uniform, and a node that never updated still does not.
		const unflipped = texture( plain );
		expect( unflipped.getUpdateType() ).toBe( NodeUpdateType.NONE );

	} );

} );
