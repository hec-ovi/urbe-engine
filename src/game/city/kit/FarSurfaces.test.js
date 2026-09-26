import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FarSimplifier, farShells } from './FarSurfaces.js';

/**
 * A wall of many coplanar quads with a small bolt standing off it, as one
 * indexed surface whose every triangle has vertices of its own, the way a
 * producer writes its faces.
 */
function wall() {

	const panel = new THREE.PlaneGeometry( 12, 6, 24, 12 );
	const bolt = new THREE.BoxGeometry( 0.04, 0.04, 0.04 ).translate( 0, 0, 0.3 );
	panel.deleteAttribute( 'uv' );
	bolt.deleteAttribute( 'uv' );
	const soup = mergeGeometries( [ panel, bolt ], false ).toNonIndexed();
	soup.setIndex( Array.from( { length: soup.getAttribute( 'position' ).count }, ( unused, vertex ) => vertex ) );

	return soup;

}

const triangles = ( geometry ) => geometry.getIndex().count / 3;

describe( 'far surfaces', () => {

	it( 'simplifies a facade to what stands farther than a tenth of a metre apart, and keeps a glowing one whole', async () => {

		const simplifier = new FarSimplifier();
		const facade = { geometry: wall(), material: new THREE.MeshStandardMaterial() };
		const strip = { geometry: wall(), material: new THREE.MeshStandardMaterial( { emissive: 0xffffff } ) };
		const flat = { geometry: new THREE.PlaneGeometry( 2, 2 ).toNonIndexed(), material: new THREE.MeshStandardMaterial() };

		await farShells( [ facade, strip, flat ], simplifier );

		// Welded, the coplanar quads fold into a couple of triangles and the bolt,
		// finer than the error, is dropped; the far surface holds only what it draws.
		expect( triangles( facade.far ) ).toBeLessThanOrEqual( 4 );
		expect( facade.far.getAttribute( 'position' ).count ).toBeLessThanOrEqual( 8 );
		expect( Object.keys( facade.far.attributes ).sort() ).toEqual( Object.keys( facade.geometry.attributes ).sort() );
		expect( strip.far ).toBeUndefined();
		expect( flat.far ).toBeUndefined();

	} );

	it( 'answers no far surface once its worker fails, and never waits on it', async () => {

		const workers = [];
		const simplifier = new FarSimplifier( { open: () => {

			const worker = { postMessage() {}, terminate() { this.terminated = true; } };
			workers.push( worker );

			return worker;

		} } );
		const surface = { geometry: wall(), material: new THREE.MeshStandardMaterial() };
		const waiting = farShells( [ surface ], simplifier );
		workers[ 0 ].onerror( { message: 'no wasm' } );
		await waiting;

		expect( surface.far ).toBeUndefined();
		expect( workers[ 0 ].terminated ).toBe( true );
		expect( await simplifier.simplify( new Uint32Array( 3 ), 3, [ { array: new Float32Array( 9 ), itemSize: 3, stride: 3, offset: 0 } ] ) ).toBeNull();
		expect( workers ).toHaveLength( 1 );

	} );

} );
