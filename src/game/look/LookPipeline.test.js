import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { LookPipeline } from './LookPipeline.js';

afterEach( () => vi.restoreAllMocks() );

it.each( [ 0, 0.35 ] )( 'draws the world into its prepared context before composition (bloom %s)', strength => {

	const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
	let target = null, mrt = null;
	const order = [];
	const renderer = {
		samples: 4, toneMapping: THREE.AgXToneMapping, outputColorSpace: THREE.SRGBColorSpace,
		getOutputBufferType: () => THREE.HalfFloatType,
		getDrawingBufferSize: size => size.set( 1280, 720 ),
		getRenderTarget: () => target, setRenderTarget: next => { target = next; },
		getMRT: () => mrt, setMRT: next => { mrt = next; },
		render: ( actualScene, actualCamera ) => {

			order.push( 'world' );
			expect( actualScene ).toBe( scene ); expect( actualCamera ).toBe( camera );
			expect( target ).toBe( look.renderTarget ); expect( mrt ).toBe( look.mrt );
			expect( renderer.toneMapping ).toBe( THREE.NoToneMapping );
			expect( renderer.outputColorSpace ).toBe( THREE.ColorManagement.workingColorSpace );

		}
	};
	vi.spyOn( THREE.RenderPipeline.prototype, 'render' ).mockImplementation( () => {

		order.push( 'compose' );
		expect( target ).toBeNull(); expect( mrt ).toBeNull();
		expect( renderer.toneMapping ).toBe( THREE.AgXToneMapping );
		expect( renderer.outputColorSpace ).toBe( THREE.SRGBColorSpace );

	} );
	const look = new LookPipeline( renderer, scene, camera, { bloom: { strength, radius: 0.03 } } );
	// A detached floor can be compiling across frames in its linear target.
	target = look.renderTarget; mrt = look.mrt;
	renderer.toneMapping = THREE.NoToneMapping;
	renderer.outputColorSpace = THREE.ColorManagement.workingColorSpace;
	look.render();
	expect( target ).toBe( look.renderTarget ); expect( mrt ).toBe( look.mrt );
	expect( renderer.toneMapping ).toBe( THREE.NoToneMapping );
	expect( renderer.outputColorSpace ).toBe( THREE.ColorManagement.workingColorSpace );
	expect( order ).toEqual( [ 'world', 'compose' ] );
	expect( look.renderTarget.width ).toBe( 1280 ); expect( look.renderTarget.height ).toBe( 720 );
	expect( look.renderTarget.samples ).toBe( 4 );
	expect( look.renderTarget.textures ).toHaveLength( strength ? 2 : 1 );
	look.renderTarget.dispose(); look.pipeline.dispose();

} );
