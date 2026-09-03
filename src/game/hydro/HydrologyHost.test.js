import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { HydrologyHost } from './HydrologyHost.js';
import { HYDROLOGY_FIXTURES, MATERIAL_BINDINGS_FIXTURE, materialsFixture } from './fixtures/hydrology.js';

describe( 'live hydrology host', () => {

	it( 'loads the canonical binding document, mounts water, updates it and releases it', async () => {

		const scene = new THREE.Scene();
		const materials = materialsFixture();
		materials.factory.resolver.loadBindings = vi.fn( async () => MATERIAL_BINDINGS_FIXTURE );
		const host = await HydrologyHost.install( {
			blueprint: { hydrology: HYDROLOGY_FIXTURES[ 1 ] }, factory: materials.factory, scene
		} );

		expect( materials.factory.resolver.loadBindings ).toHaveBeenCalledWith( 'atlas-hydrology' );
		expect( scene.getObjectByName( 'hydrology' ) ).toBe( host.group );
		expect( host.handoff.crossings.map( ( crossing ) => crossing.kind ) ).toEqual( [ 'bridge', 'tunnel' ] );
		host.update( 12.5 );
		expect( host.group.children[ 0 ].material.normalMap.offset.toArray() ).not.toEqual( [ 0, 0 ] );
		host.dispose();
		expect( scene.getObjectByName( 'hydrology' ) ).toBeUndefined();

	} );

	it( 'does no material or scene work for a blueprint without water', async () => {

		const scene = new THREE.Scene();
		const loadBindings = vi.fn();
		const host = await HydrologyHost.install( {
			blueprint: { meta: { version: '0.14.0' } }, factory: { resolver: { loadBindings } }, scene
		} );

		expect( host.group ).toBe( null );
		expect( host.summary ).toBe( null );
		expect( loadBindings ).not.toHaveBeenCalled();
		expect( scene.children ).toEqual( [] );

	} );

} );
