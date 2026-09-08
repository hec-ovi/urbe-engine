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

	it( 'stages empty instance batches for compilation and restores their counts', async () => {

		const root = new THREE.Group();
		const instanced = new THREE.InstancedMesh(
			new THREE.BoxGeometry(),
			new THREE.MeshBasicMaterial(),
			4
		);
		instanced.count = 0;
		const geometry = new THREE.InstancedBufferGeometry().copy( new THREE.BoxGeometry() );
		geometry.instanceCount = 0;
		const custom = new THREE.Mesh( geometry, new THREE.MeshBasicMaterial() );
		root.add( instanced, custom );

		const renderer = fakeRenderer( async () => {

			expect( instanced.count ).toBe( 1 );
			expect( geometry.instanceCount ).toBe( 1 );

		} );

		await new Warmup( renderer, new THREE.Scene(), new THREE.PerspectiveCamera() ).warm( root );

		expect( instanced.count ).toBe( 0 );
		expect( geometry.instanceCount ).toBe( 0 );

	} );

	it( 'keeps inactive lights out of the staged compile', async () => {

		const root = new THREE.Group();
		const light = new THREE.PointLight();
		light.visible = false;
		root.add( light );
		const renderer = fakeRenderer( async () => {

			expect( light.visible ).toBe( false );

		} );

		await new Warmup( renderer, new THREE.Scene(), new THREE.PerspectiveCamera() ).warm( root );

		expect( light.visible ).toBe( false );

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

	it( 'serializes independent streaming requests and continues after one fails', async () => {

		const a = tree(), b = tree();
		let active = 0, peak = 0;
		const renderer = fakeRenderer( async object => {

			active ++;
			peak = Math.max( peak, active );
			await new Promise( resolve => setTimeout( resolve, 1 ) );
			active --;
			if ( object === a.mesh ) throw new Error( 'first cell failed' );

		} );
		const warmup = new Warmup( renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), { scene: true } );
		const results = await Promise.allSettled( [ warmup.warmAll( a.root ), warmup.warmAll( b.root ) ] );
		expect( results.map( result => result.status ) ).toEqual( [ 'rejected', 'fulfilled' ] );
		expect( peak ).toBe( 1 );
		expect( renderer.mrt ).toBe( 'frame' );
		expect( a.hidden.visible ).toBe( false );
		expect( b.hidden.visible ).toBe( false );

	} );

	it( 'rejects required preparation on the first failed compile after restoring the render state', async () => {

		const { root, hidden, mesh } = tree();
		const compileAsync = vi.fn( async () => { throw new Error( 'pipeline failed' ); } );
		const renderer = fakeRenderer( compileAsync );
		root.add( new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial() ) );
		await expect( new Warmup( renderer, new THREE.Scene(), new THREE.PerspectiveCamera() ).warmAll( root ) )
			.rejects.toThrow( 'pipeline failed' );
		expect( compileAsync ).toHaveBeenCalledTimes( 1 );
		expect( hidden.visible ).toBe( false );
		expect( mesh.frustumCulled ).toBe( true );
		expect( renderer.mrt ).toBe( 'frame' );

	} );

	it( 'waits for streamed maps and uploads each shared texture once', async () => {

		let ready;
		const loaded = new Promise( ( resolve ) => { ready = resolve; } );
		const texture = new THREE.Texture();
		texture[ Symbol.for( 'urbe.texture-ready' ) ] = loaded;
		const root = new THREE.Group();
		root.add(
			new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial( { map: texture } ) ),
			new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial( { map: texture } ) )
		);
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
		expect( renderer.initTexture ).toHaveBeenCalledWith( texture );

	} );

	it( 'lets frames run between renderables and stops preparing an unwanted floor', async () => {

		const root = new THREE.Group();
		for ( let i = 0; i < 10; i ++ ) root.add( new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial() ) );
		let frame = 0;
		const compiledAt = [];
		vi.stubGlobal( 'requestAnimationFrame', callback => setTimeout( () => callback( ++ frame * 16 ), 0 ) );
		const renderer = fakeRenderer( async () => { compiledAt.push( frame ); } );
		try {

			await new Warmup( renderer, new THREE.Scene(), new THREE.PerspectiveCamera() ).warmAll( root, { wanted: () => frame < 2 } );
			expect( compiledAt ).toEqual( [ 0, 1 ] );

		} finally {

			vi.unstubAllGlobals();
			root.traverse( node => { node.geometry?.dispose(); node.material?.dispose(); } );

		}

	} );

} );
