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
	 * with it when preparation is optional.
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

	it( 'stages hidden, culled and empty batches for compilation, leaves inactive lights out, and puts everything back', async () => {

		const { root, hidden, mesh } = tree();
		const instanced = new THREE.InstancedMesh( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 4 );
		instanced.count = 0;
		const geometry = new THREE.InstancedBufferGeometry().copy( new THREE.BoxGeometry() );
		geometry.instanceCount = 0;
		const custom = new THREE.Mesh( geometry, new THREE.MeshBasicMaterial() );
		const light = new THREE.PointLight();
		light.visible = false;
		root.add( instanced, custom, light );

		const seen = [];
		const renderer = fakeRenderer( async ( object ) => {

			expect( instanced.count ).toBe( 1 );
			expect( geometry.instanceCount ).toBe( 1 );
			expect( light.visible ).toBe( false );
			object.traverse( ( node ) => { if ( ! node.isLight ) seen.push( [ node.visible, node.frustumCulled ] ); } );

		} );

		await new Warmup( renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), null ).warm( root );

		expect( seen.every( ( [ visible, culled ] ) => visible === true && culled === false ) ).toBe( true );
		expect( hidden.visible ).toBe( false );
		expect( mesh.visible ).toBe( true );
		expect( mesh.frustumCulled ).toBe( true );
		expect( instanced.count ).toBe( 0 );
		expect( geometry.instanceCount ).toBe( 0 );
		expect( light.visible ).toBe( false );

	} );

	it( 'compiles against the scene and the render pipeline outputs, then restores the frame MRT', async () => {

		const { root } = tree();
		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera();
		const compileAsync = vi.fn( async () => {} );
		const renderer = fakeRenderer( compileAsync );
		const mrt = { emissive: true };
		const target = { name: 'scene pass', samples: 4 };
		renderer.toneMapping = THREE.AgXToneMapping;
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		let renderTarget = null;
		renderer.getRenderTarget = () => renderTarget;
		renderer.setRenderTarget = next => { renderTarget = next; };

		let during = null;
		compileAsync.mockImplementation( async () => {

			during = renderer.mrt;
			expect( renderTarget ).toBe( target );
			expect( renderer.toneMapping ).toBe( THREE.NoToneMapping );
			expect( renderer.outputColorSpace ).toBe( THREE.ColorManagement.workingColorSpace );

		} );

		await new Warmup( renderer, scene, camera, mrt, target ).warm( root );

		expect( compileAsync ).toHaveBeenCalledWith( root, camera, scene );
		expect( during ).toBe( mrt );
		expect( renderer.mrt ).toBe( 'frame' );
		expect( renderTarget ).toBeNull();
		expect( renderer.toneMapping ).toBe( THREE.AgXToneMapping );
		expect( renderer.outputColorSpace ).toBe( THREE.SRGBColorSpace );

	} );

	it( 'serializes independent streaming requests, rejects the caller that failed and stops an unwanted floor', async () => {

		const a = tree(), b = tree();
		for ( let i = 0; i < 3; i ++ ) b.root.add( new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial() ) );
		let active = 0, peak = 0, compiled = 0;
		const renderer = fakeRenderer( async object => {

			active ++;
			peak = Math.max( peak, active );
			compiled ++;
			await new Promise( resolve => setTimeout( resolve, 1 ) );
			active --;
			if ( object === a.mesh ) throw new Error( 'first cell failed' );

		} );
		const warmup = new Warmup( renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), { scene: true } );
		let wanted = 2;
		const results = await Promise.allSettled( [
			warmup.warmAll( a.root ),
			warmup.warmAll( b.root, { wanted: () => wanted -- > 0 } )
		] );

		expect( results.map( result => result.status ) ).toEqual( [ 'rejected', 'fulfilled' ] );
		expect( peak ).toBe( 1 );
		expect( compiled ).toBe( 3 );
		expect( renderer.mrt ).toBe( 'frame' );
		expect( a.hidden.visible ).toBe( false );
		expect( b.hidden.visible ).toBe( false );

	} );

	it( 'builds one program per material and vertex layout, counts those, and never builds one twice', async () => {

		const material = new THREE.MeshStandardMaterial();
		const other = new THREE.MeshStandardMaterial();
		const batch = new THREE.Group();
		// Six draws wearing three programs: one material over two vertex
		// layouts, which is what a batch and its instanced copies are, and one
		// material standing in three separate draws.
		for ( let i = 0; i < 3; i ++ ) batch.add( new THREE.Mesh( new THREE.BoxGeometry(), material ) );
		batch.add( new THREE.InstancedMesh( new THREE.BoxGeometry(), material, 2 ) );
		batch.add( new THREE.Mesh( new THREE.BoxGeometry(), other ), new THREE.Mesh( new THREE.BoxGeometry(), other ) );

		const compiled = [];
		const warmup = new Warmup( fakeRenderer( async ( object ) => compiled.push( object ) ), new THREE.Scene(), new THREE.PerspectiveCamera(), null );
		const counted = [];
		await warmup.warmAll( batch, { onProgress: ( done, total ) => counted.push( [ done, total ] ) } );

		expect( compiled ).toHaveLength( 3 );
		expect( counted ).toEqual( [ [ 1, 3 ], [ 2, 3 ], [ 3, 3 ] ] );

		// The city pass finds the same materials standing somewhere else.
		const elsewhere = new THREE.Group();
		elsewhere.add( new THREE.Mesh( new THREE.BoxGeometry(), material ), new THREE.Mesh( new THREE.BoxGeometry(), other ) );
		await warmup.warmAll( elsewhere );

		expect( compiled ).toHaveLength( 3 );

	} );

	it( 'waits for streamed node resources, uploads each shared texture once, and rejects a failed one before upload', async () => {

		let ready;
		const loaded = new Promise( ( resolve ) => { ready = resolve; } );
		const texture = new THREE.Texture();
		const root = new THREE.Group();
		root.add(
			new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial() ),
			new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial() )
		);
		for ( const mesh of root.children ) mesh.material[ Symbol.for( 'urbe.material-resources' ) ] = [ { texture, ready: loaded } ];
		const renderer = fakeRenderer( async () => {

			expect( renderer.initTexture ).toHaveBeenCalledWith( texture );

		} );
		renderer.initTexture = vi.fn();
		const warmup = new Warmup( renderer, new THREE.Scene(), new THREE.PerspectiveCamera() );
		const pending = warmup.warm( root );

		await Promise.resolve();
		expect( renderer.initTexture ).not.toHaveBeenCalled();
		ready();
		await pending;
		await warmup.warm( root );

		expect( renderer.initTexture ).toHaveBeenCalledTimes( 1 );

		const failing = tree();
		let reject;
		const failed = new Promise( ( resolve, failure ) => { reject = failure; } );
		failing.mesh.material[ Symbol.for( 'urbe.material-resources' ) ] = [ { texture: new THREE.Texture(), ready: failed } ];
		const second = fakeRenderer( vi.fn() );
		second.initTexture = vi.fn();
		const rejected = new Warmup( second, new THREE.Scene(), new THREE.PerspectiveCamera() ).warmAll( failing.root );
		await Promise.resolve();
		reject( new Error( 'source map missing' ) );

		await expect( rejected ).rejects.toThrow( 'source map missing' );
		expect( second.initTexture ).not.toHaveBeenCalled();
		expect( second.compileAsync ).not.toHaveBeenCalled();

	} );

} );
