import { describe, expect, it, vi } from 'vitest';
import { WorldColliders } from './WorldColliders.js';
import * as THREE from 'three/webgpu';
import { Physics } from './Physics.js';

describe( 'city collider installation', () => {

	it( 'cooks static sources in bounded disabled pieces and releases staging data', async () => {

		const geometry = floorGeometry(), handles = [], chunks = [];
		const physics = {
			addTrimesh( chunk, { enabled } ) {

				chunks.push( chunk.attributes.position.count / 3 );
				const handle = { triangles: chunk.attributes.position.count / 3,
					body: { setEnabled: vi.fn() } };
				expect( enabled ).toBe( false );
				handles.push( handle );
				return handle;

			},
			addPost: vi.fn(), remove: vi.fn()
		};
		const disposed = vi.spyOn( geometry, 'dispose' );
		const colliders = new WorldColliders( physics );
		await colliders.addStaticsAsync( new Map( [ [ 'shell', geometry ] ] ), { release: true } );
		expect( chunks.every( count => count <= 2048 ) ).toBe( true );
		expect( colliders.triangles ).toBe( geometry.index.count / 3 );
		expect( handles.every( handle => handle.body.setEnabled.mock.calls[ 0 ][ 0 ] ) ).toBe( true );
		expect( disposed ).toHaveBeenCalledOnce();
		const posts = [ { x: 1, z: 2, height: 4, radius: 0.1, base: 0 } ];
		await colliders.addPostsAsync( posts );
		expect( physics.addPost ).toHaveBeenCalledWith( posts[ 0 ] );

	} );

	it( 'keeps the source label on failed admission and releases staging geometry', async () => {

		const bad = floorGeometry( 2 ), disposed = vi.spyOn( bad, 'dispose' );
		const colliders = new WorldColliders( {
			addTrimesh: () => { throw new Error( 'wasm rejected mesh' ); }, remove: vi.fn()
		} );
		await expect( colliders.addStaticsAsync( new Map( [ [ 'building p15', bad ] ] ), { release: true } ) )
			.rejects.toThrow( 'building p15 collider failed: wasm rejected mesh' );
		expect( disposed ).toHaveBeenCalledOnce();

	} );

} );

function floorGeometry( count = 9000 ) {
	const vertices = [], indices = [];
	for ( let i = 0; i < count / 2; i ++ ) {
		const x = i % 100, z = Math.floor( i / 100 ), first = vertices.length / 3;
		vertices.push( x, 0, z, x + 1, 0, z, x + 1, 0, z + 1, x, 0, z + 1 );
		indices.push( first, first + 2, first + 1, first, first + 3, first + 2 );
	}
	return new THREE.BufferGeometry().setAttribute( 'position', new THREE.Float32BufferAttribute( vertices, 3 ) ).setIndex( indices );
}

describe( 'streamed band collision admission', () => {
	it.each( [ 'indexed geometry', 'position arrays' ] )( 'admits exact %s in bounded disabled pieces before exposing the complete floor', async mode => {
		const physics = await Physics.create(), colliders = new WorldColliders( physics );
		const geometry = floorGeometry(), expanded = geometry.toNonIndexed();
		const positions = expanded.attributes.position.array;
		const source = mode === 'indexed geometry' ? geometry : [ positions.subarray( 0, 900 ), positions.subarray( 900 ) ];
		const frames = [], cooked = [], handles = [];
		vi.stubGlobal( 'requestAnimationFrame', callback => { frames.push( callback ); } );
		const add = physics.addTrimesh.bind( physics );
		vi.spyOn( physics, 'addTrimesh' ).mockImplementation( ( chunk, options ) => {
			cooked.push( chunk.attributes.position.array.slice() );
			const handle = add( chunk, options ); handles.push( handle ); return handle;
		} );
		try {
			const ready = colliders.addBand( 'floor', source );
			expect( cooked.length ).toBeGreaterThan( 0 ); expect( cooked.length ).toBeLessThanOrEqual( 4 );
			expect( handles.every( handle => ! handle.body.isEnabled() ) ).toBe( true );
			expect( handles.every( handle => handle.collider.density() === 0 ) ).toBe( true );
			expect( colliders.liveBands ).toBe( 0 );
			physics.step( 1 / 60 );
			const ray = new physics.rapier.Ray( { x: 0.2, y: 3, z: 0.2 }, { x: 0, y: - 1, z: 0 } );
			expect( physics.world.castRay( ray, 5, true ) ).toBeNull();
			while ( colliders.pending.size ) { frames.shift()?.( 0 ); await new Promise( resolve => setTimeout( resolve, 0 ) ); }
			expect( await ready ).toBe( true );
			expect( cooked.every( chunk => chunk.length / 9 <= 2048 ) ).toBe( true );
			expect( new Float32Array( cooked.flatMap( chunk => Array.from( chunk ) ) ) ).toEqual( positions );
			expect( handles.every( handle => handle.body.isEnabled() ) ).toBe( true );
			physics.step( 1 / 60 );
			expect( physics.world.castRay( ray, 5, true ).timeOfImpact ).toBeCloseTo( 3 );
			expect( colliders.liveBands ).toBe( 1 );
			colliders.dropBand( 'floor' );
			expect( physics.world.bodies.len() ).toBe( 0 );
		} finally { vi.unstubAllGlobals(); geometry.dispose(); expanded.dispose(); physics.world.free(); }
	} );

	it( 'cancels pending pieces without publishing a partial band and releases pieces after invalid input', async () => {
		const physics = await Physics.create(), colliders = new WorldColliders( physics ), geometry = floorGeometry();
		const frames = [];
		vi.stubGlobal( 'requestAnimationFrame', callback => { frames.push( callback ); } );
		try {
			const ready = colliders.addBand( 'floor', geometry );
			colliders.dropBand( 'floor' );
			expect( physics.world.bodies.len() ).toBe( 0 );
			frames.shift()( 0 );
			expect( await ready ).toBe( false ); expect( colliders.liveBands ).toBe( 0 );
			await expect( colliders.addBand( 'bad', [ new Float32Array( [ 0, 0, 0, 0, 0, 1, 1, 0, 0 ] ), new Float32Array( 4 ) ] ) ).rejects.toThrow( 'E_PHYSICS_BAND' );
			await expect( colliders.addBand( 'bad', [ new Float32Array( 9 ).fill( NaN ) ] ) ).rejects.toThrow( 'E_PHYSICS_BAND' );
			expect( physics.world.bodies.len() ).toBe( 0 ); expect( colliders.liveBands ).toBe( 0 );
		} finally { vi.unstubAllGlobals(); geometry.dispose(); physics.world.free(); }
	} );

	it( 'holds a cell of kit buildings as one fixed body of cuboids and frees it on a drop', async () => {
		const physics = await Physics.create(), colliders = new WorldColliders( physics );
		const boxes = [
			{ center: [ 0, 4, 0 ], halfExtents: [ 12, 4, 0.25 ], rotationY: 0 },
			{ center: [ 6, 4, 8 ], halfExtents: [ 0.25, 4, 16 ], rotationY: Math.PI / 2 }
		];
		try {
			expect( colliders.addBoxes( 'kit:0:0', boxes ) ).toBe( true );
			expect( colliders.boxes ).toBe( 2 );
			expect( physics.world.bodies.len() ).toBe( 1 );
			expect( physics.world.colliders.len() ).toBe( 2 );
			expect( colliders.addBoxes( 'kit:0:0', boxes ) ).toBe( true );
			expect( physics.world.bodies.len() ).toBe( 1 );
			colliders.dropBand( 'kit:0:0' );
			expect( colliders.boxes ).toBe( 0 );
			expect( physics.world.bodies.len() ).toBe( 0 );
			expect( physics.world.colliders.len() ).toBe( 0 );
			expect( () => colliders.addBoxes( 'bad', [ { center: [ 0, 0, 0 ], halfExtents: [ 1, 0, 1 ] } ] ) )
				.toThrow( 'E_PHYSICS_BOXES' );
			expect( physics.world.bodies.len() ).toBe( 0 );
		} finally { physics.world.free(); }
	} );

	it( 'releases both completed pieces and the current body when Rapier rejects a cook', async () => {
		const physics = await Physics.create(), colliders = new WorldColliders( physics );
		const triangle = new Float32Array( [ 0, 0, 0, 0, 0, 1, 1, 0, 0 ] );
		const create = physics.world.createCollider.bind( physics.world );
		vi.spyOn( physics.world, 'createCollider' )
			.mockImplementationOnce( create )
			.mockImplementationOnce( () => { throw new Error( 'Rapier cook failed' ); } );
		try {
			await expect( colliders.addBand( 'floor', [ triangle, triangle ] ) ).rejects.toThrow( 'Rapier cook failed' );
			expect( colliders.liveBands ).toBe( 0 );
			expect( physics.world.bodies.len() ).toBe( 0 );
			expect( physics.world.colliders.len() ).toBe( 0 );
		} finally { physics.world.free(); }
	} );
} );
