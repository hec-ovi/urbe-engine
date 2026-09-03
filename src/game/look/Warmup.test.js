import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { Warmup } from './Warmup.js';

/**
 * The warm-up exists so a first draw is never a first link. Four things it has
 * to get right, each of which silently loses the whole point when it does not:
 * the objects it compiles have to be reachable by the compile (hidden and
 * culled ones are exactly the ones worth warming), it has to compile against
 * the scene the object will be lit by and the outputs the frame writes, it has
 * to leave the tree untouched afterwards, and it must never take the run down
 * with it.
 */
describe( 'Warmup', () => {

	const tree = () => {

		const root = new THREE.Group();
		const hidden = new THREE.Group();
		const mesh = new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial() );

		hidden.visible = false;
		root.add( hidden );
		hidden.add( mesh );

		return { root, hidden, mesh };

	};

	const fakeRenderer = ( compileAsync ) => {

		let mrt = 'frame';

		return {
			compileAsync,
			getMRT: () => mrt,
			setMRT: ( next ) => {

				mrt = next;

			},
			get mrt() {

				return mrt;

			}
		};

	};

	it( 'compiles hidden and frustum-culled objects, and puts both back', async () => {

		const { root, hidden, mesh } = tree();
		const seen = [];
		const renderer = fakeRenderer( async ( object ) => {

			object.traverse( ( node ) => seen.push( [ node.visible, node.frustumCulled ] ) );

		} );
		const scene = new THREE.Scene();

		await new Warmup( renderer, scene, new THREE.PerspectiveCamera(), null ).warm( root );

		expect( seen.every( ( [ visible, culled ] ) => visible === true && culled === false ) ).toBe( true );
		expect( hidden.visible ).toBe( false );
		expect( mesh.visible ).toBe( true );
		expect( mesh.frustumCulled ).toBe( true );

	} );

	it( 'compiles against the scene and the render pipeline outputs, then restores the frame MRT', async () => {

		const { root } = tree();
		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera();
		const compileAsync = vi.fn( async () => {} );
		const renderer = fakeRenderer( compileAsync );
		const mrt = { emissive: true };

		let during = null;
		compileAsync.mockImplementation( async () => {

			during = renderer.mrt;

		} );

		await new Warmup( renderer, scene, camera, mrt ).warm( root );

		expect( compileAsync ).toHaveBeenCalledWith( root, camera, scene );
		expect( during ).toBe( mrt );
		expect( renderer.mrt ).toBe( 'frame' );

	} );

	it( 'survives a compile that throws and leaves the tree as it found it', async () => {

		const { root, hidden } = tree();
		const renderer = fakeRenderer( async () => {

			throw new Error( 'device lost' );

		} );

		vi.spyOn( console, 'warn' ).mockImplementation( () => {} );

		await expect( new Warmup( renderer, new THREE.Scene(), new THREE.PerspectiveCamera() ).warm( root ) )
			.resolves.toBeGreaterThanOrEqual( 0 );
		expect( hidden.visible ).toBe( false );
		expect( renderer.mrt ).toBe( 'frame' );

		vi.restoreAllMocks();

	} );

	it( 'warms a world one renderable at a time', async () => {

		const { root } = tree();
		root.add( new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial() ) );
		let active = 0;
		let peak = 0;
		const compileAsync = vi.fn( async () => {

			active ++;
			peak = Math.max( peak, active );
			await Promise.resolve();
			active --;

		} );

		await new Warmup( fakeRenderer( compileAsync ), new THREE.Scene(), new THREE.PerspectiveCamera() ).warmAll( root );

		expect( compileAsync ).toHaveBeenCalledTimes( 2 );
		expect( peak ).toBe( 1 );

	} );

} );
