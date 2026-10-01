import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { NightLook } from './NightLook.js';
import { LightingSystem, LightingSlot } from '../light/LightingSystem.js';

/** What a renderer is to the look before its first frame, on the backend named. */
function renderer( webgpu = false ) {

	let ratio = 1;
	return {
		backend: { isWebGPUBackend: webgpu },
		lighting: new THREE.Lighting(),
		getPixelRatio: () => ratio,
		setPixelRatio: ( value ) => { ratio = value; }
	};

}

/** The render lists three builds at init keep the lighting the renderer held then. */
function init( target ) {

	return { lighting: target.lighting };

}

const originalRatio = globalThis.devicePixelRatio;
afterEach( () => { globalThis.devicePixelRatio = originalRatio; } );

describe( 'the night look on a renderer', () => {

	it( 'reaches the render lists three built at init with the lighting it chose after', () => {

		for ( const webgpu of [ false, true ] ) {

			const target = LightingSystem.prepare( renderer( webgpu ) );
			expect( target.lighting ).toBeInstanceOf( LightingSlot );
			const lists = init( target );
			const look = NightLook.begin( target, { quality: 'high', backend: webgpu ? 'webgpu' : 'webgl' } );
			const scene = new THREE.Scene();
			const node = lists.lighting.getNode( scene );

			expect( look.lighting.capacity ).toBe( webgpu ? look.tier.clusteredLights : look.tier.batchedLights );
			expect( node.constructor.type ).toBe( webgpu ? 'ClusteredLightsNode' : 'MaterialLitDynamicLightsNode' );
			// One node per scene, whichever lighting asked for the scene first.
			expect( lists.lighting.getNode( scene ) ).toBe( node );
			expect( new THREE.Lighting().getNode( scene ) ).not.toBe( node );

		}

	} );

	it( 'batches the city lights and still builds what each material lights itself with', () => {

		const target = LightingSystem.prepare( renderer() );
		NightLook.begin( target, { quality: 'high', backend: 'webgl' } );
		const lamps = Array.from( { length: 3 }, () => new THREE.PointLight() );
		const environment = new THREE.Node();
		const occlusion = new THREE.Node();
		const node = target.lighting.createNode( [ ...lamps, new THREE.DirectionalLight() ] );
		const built = node.setupLightsNode( { context: { materialLightings: [ environment, occlusion ] }, renderer: { library: null } } );

		expect( built.slice( 0, 2 ) ).toEqual( [ environment, occlusion ] );
		// The point lights a frame hands its fragments are only those that reach what it sees (LightReach).
		expect( built.slice( 2 ).map( ( one ) => one.constructor.type ).sort() ).toEqual( [ 'DirectionalLightDataNode', 'ReachedPointLightDataNode' ] );
		expect( built.find( ( one ) => one.constructor.type === 'ReachedPointLightDataNode' )._lights ).toEqual( lamps );

	} );

	it( 'renders at most the tier\'s pixel ratio', () => {

		for ( const [ quality, device, expected ] of [ [ 'medium', 2, 1 ], [ 'high', 2, 1.5 ], [ 'ultra', 3, 2 ], [ 'high', 1, 1 ] ] ) {

			globalThis.devicePixelRatio = device;
			const target = renderer();
			NightLook.begin( target, { quality, backend: 'webgl' } );
			expect( target.getPixelRatio() ).toBe( expected );

		}

	} );

} );
