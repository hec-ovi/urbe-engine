import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { Warmup } from './Warmup.js';
import { FrameBudget } from '../../app/FrameBudget.js';

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
		let active = 0, peak = 0;
		const compiled = [];
		const renderer = fakeRenderer( async object => {

			active ++;
			peak = Math.max( peak, active );
			compiled.push( object );
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
		// The failed cell and the two wanted programs of the other, and nothing else.
		expect( compiled ).toHaveLength( 3 );
		expect( renderer.mrt ).toBe( 'frame' );
		expect( a.hidden.visible ).toBe( false );
		expect( b.hidden.visible ).toBe( false );

	} );

	it( 'prepares one graph per material and vertex layout, one per instanced or batched draw, and pins every program it linked without a second compile', async () => {

		const material = new THREE.MeshStandardMaterial();
		const other = new THREE.MeshStandardMaterial();
		const box = new THREE.BoxGeometry();
		const batch = new THREE.Group();
		// Nine draws asking for five graphs: one material standing in three plain
		// draws, the same material on two instanced draws (the renderer binds
		// each one's own buffers, so each is its own graph), a coloured batch of
		// it, and another material in two separate draws.
		for ( let i = 0; i < 3; i ++ ) batch.add( new THREE.Mesh( box, material ) );
		batch.add( new THREE.InstancedMesh( box, material, 2 ), new THREE.InstancedMesh( box, material, 2 ) );
		const batched = new THREE.BatchedMesh( 4, 3 * 24, 3 * 36, material );
		batched.setColorAt( batched.addInstance( batched.addGeometry( box ) ), new THREE.Color( 1, 0, 0 ) );
		batch.add( batched );
		batch.add( new THREE.Mesh( box, other ), new THREE.Mesh( box, other ) );

		// The renderer's own caches, as three keeps them: a pipeline per code
		// and a graph per key, each counting its draws (ProgramPins.test.js).
		const pipelines = new Map(), graphs = new Map();
		const compiled = [];
		const renderer = fakeRenderer( async ( object ) => {

			compiled.push( object );
			const code = `${object.material.uuid}:${object.isInstancedMesh || object.isBatchedMesh ? 'instanced' : 'plain'}`;
			const program = () => ( { usedTimes: 0 } );
			if ( ! pipelines.has( code ) ) pipelines.set( code, { usedTimes: 0, vertexProgram: program(), fragmentProgram: program() } );
			pipelines.get( code ).usedTimes ++;
			graphs.set( object.uuid, { usedTimes: 1, plain: ! object.isInstancedMesh && ! object.isBatchedMesh } );

		} );
		renderer._pipelines = { caches: pipelines };
		renderer._nodes = { nodeBuilderCache: graphs };
		const warmup = new Warmup( renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), null );
		const counted = [];
		await warmup.warmAll( batch, { onProgress: ( done, total ) => counted.push( [ done, total ] ) } );

		expect( compiled ).toHaveLength( 5 );
		expect( counted ).toEqual( [ [ 1, 5 ], [ 2, 5 ], [ 3, 5 ], [ 4, 5 ], [ 5, 5 ] ] );
		// One more use on every pipeline and on both its stages: the plain and
		// instanced forms of one material, and the other material.
		expect( warmup.pins.size ).toBe( 3 );
		for ( const pipeline of pipelines.values() ) {

			expect( pipeline.vertexProgram.usedTimes ).toBe( 1 );
			expect( pipeline.fragmentProgram.usedTimes ).toBe( 1 );

		}
		// The plain draws' graphs stay for the next draw of that material; an
		// instanced or batched draw's graph is that object's and leaves with it.
		for ( const graph of graphs.values() ) expect( graph.usedTimes ).toBe( graph.plain ? 2 : 1 );

		// The city pass finds the same materials standing somewhere else.
		const elsewhere = new THREE.Group();
		elsewhere.add( new THREE.Mesh( box, material ), new THREE.Mesh( box, other ) );
		await warmup.warmAll( elsewhere );

		expect( compiled ).toHaveLength( 5 );

	} );

	it( 'gives the event loop its turn between programs while the game loads, never a frame, and a frame once the city is drawn', async () => {

		const frames = vi.fn( ( callback ) => setTimeout( callback, 0 ) );
		vi.stubGlobal( 'requestAnimationFrame', frames );
		const meshes = ( count ) => {

			const group = new THREE.Group();
			for ( let i = 0; i < count; i ++ ) group.add( new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial() ) );
			return group;

		};
		try {

			// Each compile holds the main thread past a slice, so every step asks for its turn.
			const renderer = fakeRenderer( async () => {

				const until = performance.now() + 6;
				while ( performance.now() < until );

			} );
			const warmup = new Warmup( renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), null, null, {
				budget: new FrameBudget( { paced: false } )
			} );
			await warmup.warmAll( meshes( 4 ) );
			expect( frames ).not.toHaveBeenCalled();

			warmup.pace();
			await warmup.warmAll( meshes( 2 ) );
			expect( frames ).toHaveBeenCalled();

		} finally {

			vi.unstubAllGlobals();

		}

	} );

	it( 'prepares a sibling pass for another render target with the same uploads and pins, leaving skipped groups out', async () => {

		const scene = new THREE.Scene();
		const crowd = new THREE.Group();
		crowd.add( new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial() ) );
		const street = new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial() );
		scene.add( crowd, street );
		const compiled = [];
		const targets = [];
		const renderer = fakeRenderer( async ( object ) => { compiled.push( object ); targets.push( renderer.getRenderTarget() ); } );
		let renderTarget = null;
		renderer.getRenderTarget = () => renderTarget;
		renderer.setRenderTarget = next => { renderTarget = next; };
		renderer.initTexture = vi.fn();
		street.material.map = new THREE.Texture();

		const frame = new Warmup( renderer, scene, new THREE.PerspectiveCamera(), null, { name: 'frame' } );
		await frame.warmAll( scene );
		const cube = { name: 'cube' };
		const probe = frame.sibling( { camera: new THREE.PerspectiveCamera(), renderTarget: cube, mrt: null } );
		await probe.warmAll( scene, { skip: ( node ) => node === crowd } );

		// The frame pass built both draws; the probe pass built the street
		// alone, against its own target, uploaded nothing again and shares the
		// frame's pins and budget.
		expect( compiled ).toEqual( [ crowd.children[ 0 ], street, street ] );
		expect( targets.at( - 1 ) ).toBe( cube );
		expect( renderer.initTexture ).toHaveBeenCalledTimes( 1 );
		expect( probe.pins ).toBe( frame.pins );
		expect( probe.budget ).toBe( frame.budget );
		// One queue for the family: a pass that brings its own pacing still
		// waits for the frame's compiles, since each holds the renderer's target.
		const own = { step: async () => {}, pace() {} };
		const paced = frame.sibling( { renderTarget: cube, mrt: null, budget: own } );
		expect( paced.budget ).toBe( own );
		expect( paced.queue ).toBe( frame.queue );
		let active = 0, peak = 0;
		renderer.compileAsync = async () => { active ++; peak = Math.max( peak, active ); await new Promise( ( resolve ) => setTimeout( resolve, 1 ) ); active --; };
		const more = new THREE.Group();
		more.add( new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial() ) );
		await Promise.all( [ frame.warmAll( more ), paced.warmAll( more ) ] );
		expect( peak ).toBe( 1 );

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

	it( 'names in the hitch log a graph build or a map upload that held the thread, and nothing quicker', async () => {

		const notes = [];
		const hitches = { note: ( what, ms ) => notes.push( [ what, ms ] ) };
		let spin = 6;
		const renderer = {
			...fakeRenderer( () => {

				const until = performance.now() + spin;
				while ( performance.now() < until );
				return Promise.resolve();

			} ),
			initTexture: () => {

				const until = performance.now() + 5;
				while ( performance.now() < until );

			}
		};
		const warmup = new Warmup( renderer, new THREE.Scene(), new THREE.PerspectiveCamera(), null, null, { hitches, budget: new FrameBudget( { paced: false } ) } );
		const map = new THREE.Texture();
		map.name = 'brick';
		const slow = new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial( { map } ) );
		slow.name = 'slow-batch';
		await warmup.warm( slow );
		expect( notes.map( ( [ what ] ) => what ) ).toEqual( [ 'upload brick', 'warm-up slow-batch' ] );
		expect( notes.every( ( [ , ms ] ) => ms >= 4 ) ).toBe( true );

		// A sibling for another pass names its work in the same log; a quick one names nothing.
		spin = 0;
		notes.length = 0;
		await warmup.sibling().warm( new THREE.Mesh( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial() ) );
		expect( notes ).toEqual( [] );

	} );

} );
