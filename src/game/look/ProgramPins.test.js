import { describe, expect, it, vi } from 'vitest';
import Pipelines from 'three/src/renderers/common/Pipelines.js';
import NodeManager from 'three/src/renderers/common/nodes/NodeManager.js';
import Info from 'three/src/renderers/common/Info.js';
import { ProgramPins, plainDraw } from './ProgramPins.js';
import * as THREE from 'three/webgpu';

/**
 * A pin is one more use of what the renderer caches, so everything here runs
 * three's own cache classes, the ones its renderer holds as `_pipelines` and
 * `_nodes`: an upgrade that renames them or changes how a last use frees a
 * program fails here, not as a link in the middle of play.
 */
describe( 'ProgramPins', () => {

	const backend = () => ( {
		createProgram: vi.fn(),
		createRenderPipeline: vi.fn(),
		getRenderCacheKey: () => 'state',
		needsRenderUpdate: () => false
	} );

	const draw = ( code = 'a' ) => ( {
		isRenderObject: true,
		material: { name: code },
		getNodeBuilderState: () => ( { vertexShader: `vertex ${code}`, fragmentShader: `fragment ${code}` } )
	} );

	it( 'keeps a pinned pipeline and its stages when their last draw leaves, so the next draw of that code links nothing', () => {

		const gpu = backend();
		const pipelines = new Pipelines( gpu, null, new Info() );
		const renderer = { _pipelines: pipelines };
		const pins = new ProgramPins();

		const first = draw();
		pipelines.getForRender( first );
		expect( pins.pin( renderer ) ).toBe( 1 );
		expect( pins.pin( renderer ) ).toBe( 0 );
		pipelines.delete( first );

		pipelines.getForRender( draw() );
		expect( gpu.createRenderPipeline ).toHaveBeenCalledTimes( 1 );
		expect( gpu.createProgram ).toHaveBeenCalledTimes( 2 );

		// Without the pin the same sequence links again: this is what the pin is for.
		const bare = backend();
		const unpinned = new Pipelines( bare, null, new Info() );
		const alone = draw();
		unpinned.getForRender( alone );
		unpinned.delete( alone );
		unpinned.getForRender( draw() );
		expect( bare.createRenderPipeline ).toHaveBeenCalledTimes( 2 );

	} );

	it( 'keeps the graphs a plain draw added and lets an instanced draw\'s graphs leave with it', () => {

		const nodes = new NodeManager( {}, {} );
		const renderer = { _nodes: nodes };
		const pins = new ProgramPins();
		const stand = ( key ) => {

			const object = { ...draw(), initialCacheKey: key };
			const state = { usedTimes: 1 };
			nodes.nodeBuilderCache.set( key, state );
			nodes.get( object ).nodeBuilderState = state;
			return object;

		};

		const plain = stand( 1 );
		pins.pin( renderer, true );
		const instanced = stand( 2 );
		pins.pin( renderer, false );
		nodes.delete( plain );
		nodes.delete( instanced );

		expect( nodes.nodeBuilderCache.has( 1 ) ).toBe( true );
		expect( nodes.nodeBuilderCache.has( 2 ) ).toBe( false );

	} );

	it( 'pins nothing on a renderer without those caches', () => {

		expect( new ProgramPins().pin( {}, true ) ).toBe( 0 );
		expect( new ProgramPins().pin( null ) ).toBe( 0 );

	} );

	it( 'reads a draw as plain unless its graph is keyed by the object: instanced, batched or drawn more than once', () => {

		const box = new THREE.BoxGeometry();
		const material = new THREE.MeshBasicMaterial();
		expect( plainDraw( new THREE.Mesh( box, material ) ) ).toBe( true );
		expect( plainDraw( new THREE.InstancedMesh( box, material, 2 ) ) ).toBe( false );
		expect( plainDraw( new THREE.BatchedMesh( 1, 24, 36, material ) ) ).toBe( false );

	} );

} );
