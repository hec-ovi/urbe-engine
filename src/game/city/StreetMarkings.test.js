import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { StreetMarkings } from './StreetMarkings.js';

describe( 'game street markings', () => {

	const atlas = { streets: { nodes: [], edges: [], crossings: [] } };
	const bindings = { version: 1, surfaces: {
		white: { kind: 'street-marking-white', variant: 'paint' },
		accent: { kind: 'street-marking-orange', variant: 'paint' }
	} };

	it( 'loads catalog bindings and returns only the Ground normal-paint group', async () => {

		const resolver = { loadBindings: vi.fn( async () => bindings ) };
		const material = new THREE.MeshStandardMaterial();
		const factory = { build: vi.fn( () => material ) };
		const source = { streets: {
			edges: [ { id: 'e', from: 'a', to: 'b', path: [ [ 0, 0 ], [ 20, 0 ] ], width: 1,
				elevationProfile: [ { distance: 0, level: 0.4 }, { distance: 20, level: 0.4 } ] } ],
			crossings: [ { nodeId: 'a', segments: [ {
				edgeId: 'e', from: [ 5, -1 ], to: [ 5, 1 ], width: 3,
				markings: [ [ [ 3.5, -0.25 ], [ 6.5, -0.25 ], [ 6.5, 0.25 ], [ 3.5, 0.25 ] ] ]
			} ] } ]
		} };
		const group = await StreetMarkings.build( source, { road: { lanes: [] } }, factory, resolver, 'paint' );
		expect( resolver.loadBindings ).toHaveBeenCalledExactlyOnceWith( 'street-markings' );
		expect( group ).toBeInstanceOf( THREE.Group );
		expect( group.children ).toHaveLength( 1 );
		expect( group.children[ 0 ].material ).toBe( material );
		const bounds = new THREE.Box3().setFromObject( group );
		expect( bounds.max.x - bounds.min.x ).toBe( 3 );
		expect( bounds.max.z - bounds.min.z ).toBe( 0.5 );
		expect( bounds.min.y ).toBeCloseTo( 0.403 );
		expect( bounds.max.y ).toBeCloseTo( 0.403 );

	} );

	it( 'propagates a missing binding without producing substitute paint', async () => {

		const error = new Error( 'missing binding' );
		const resolver = { loadBindings: async () => { throw error; } };
		await expect( StreetMarkings.build( atlas, { road: { lanes: [] } }, {}, resolver, 'paint' ) ).rejects.toBe( error );

	} );

	it.each( [ 'debug', 'glow' ] )( 'keeps %s centerlines on authoritative ramp heights without loading paint', async mode => {

		const resolver = { loadBindings: vi.fn() };
		const networks = { road: { lanes: [ {
			id: 'ramp', index: 0, path3: [ [ 0, 0, 0 ], [ 30, 8, 0 ] ]
		} ] } };
		const group = await StreetMarkings.build( atlas, networks, {}, resolver, mode );
		expect( resolver.loadBindings ).not.toHaveBeenCalled();
		expect( group.name ).toBe( 'lane-debug' );
		const position = group.children[ 0 ].geometry.getAttribute( 'position' );
		const heights = Array.from( { length: position.count }, ( _, i ) => position.getY( i ) );
		expect( Math.max( ...heights ) ).toBeCloseTo( 8 + ( mode === 'debug' ? 0.02 : 0.012 ) );

	} );

	it( 'refuses a diagnostic lane without its 3D path', async () => {

		await expect( StreetMarkings.build( atlas, { road: { lanes: [ { id: 'missing' } ] } }, {}, {}, 'debug' ) )
			.rejects.toThrow( /E_MOVEMENT_PATH3/ );

	} );

} );
