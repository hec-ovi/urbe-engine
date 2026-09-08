import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { StreetLamps, streetLampAssembly } from './StreetLamps.js';
import { streetLampFixture } from './fixtures/street-lamps.js';

const tick = () => new Promise( resolve => setTimeout( resolve, 0 ) );
function setup() {

	const { atlas, walk } = streetLampFixture();
	const material = new THREE.MeshStandardMaterial();
	const factory = { build: () => material, variant: () => material };
	const author = new StreetLamps( atlas, factory, walk );
	const whole = author.build();
	const position = { x: whole.posts[ 0 ].x, z: whole.posts[ 0 ].z };
	return { whole, material, position, stream: author.stream( { cellSize: 32 } ) };

}

describe( 'spatial street fixture admission', () => {

	it( 'keeps stable whole-plan reservations and instances only nearby original fixture geometry', async () => {

		const { whole, stream, position, material } = setup();
		const materialDispose = vi.spyOn( material, 'dispose' );
		await stream.update( position, { radius: 45, collisionRadius: 20 } );
		expect( stream.allPostReservations ).toEqual( whole.posts );
		expect( stream.posts.length ).toBeGreaterThan( 0 );
		expect( stream.posts.length ).toBeLessThan( whole.posts.length );
		const before = stream.glows.slice(), reserved = stream.allPostReservations;
		const geometries = new Set(), instances = [];
		stream.group.traverse( node => { if ( node.isMesh ) { expect( node.isInstancedMesh ).toBe( true ); geometries.add( node.geometry ); instances.push( node ); } } );
		expect( geometries.size ).toBeLessThanOrEqual( 5 );
		expect( stream.group.children.every( cell => cell.children.length <= 5 ) ).toBe( true );
		const ids = instances.filter( mesh => mesh.userData.streetFixtures.role === 'structure' ).flatMap( mesh => mesh.userData.streetFixtures.ids );
		expect( new Set( ids ).size ).toBe( ids.length );

		// An instance is the original authored model in the post's full rigid pose.
		const mesh = instances.find( node => node.userData.streetFixtures.kind === 'post' && node.userData.streetFixtures.role === 'structure' );
		const index = Number( mesh.userData.streetFixtures.ids[ 0 ].split( ':' )[ 1 ] );
		const post = whole.posts[ index ];
		const original = streetLampAssembly( { x: post.x, z: post.z, ax: post.head.aim.x, az: post.head.aim.z } );
		const expected = original.structure.slice( 1 ).flatMap( geometry => Array.from( geometry.attributes.position.array ) );
		const matrix = new THREE.Matrix4(); mesh.getMatrixAt( 0, matrix );
		const actual = mesh.geometry.clone().applyMatrix4( matrix );
		expect( actual.attributes.position.array.length ).toBe( expected.length );
		for ( const [ i, value ] of actual.attributes.position.array.entries() ) expect( value ).toBeCloseTo( expected[ i ], 4 );
		actual.dispose();
		const poleMesh = instances.find( node => node.userData.streetFixtures.role === 'pole'
			&& node.userData.streetFixtures.ids.includes( `lamp:${index}` ) );
		poleMesh.getMatrixAt( poleMesh.userData.streetFixtures.ids.indexOf( `lamp:${index}` ), matrix );
		const pole = poleMesh.geometry.clone().applyMatrix4( matrix );
		expect( pole.attributes.position.array ).toEqual( original.structure[ 0 ].attributes.position.array );
		pole.dispose();
		for ( const geometry of [ ...original.structure, ...original.lenses ] ) geometry.dispose();

		const released = instances.map( node => vi.spyOn( node, 'dispose' ) );
		const templateDisposal = [ ...geometries ].map( geometry => vi.spyOn( geometry, 'dispose' ) );
		await stream.update( { x: 5000, z: 5000 } );
		expect( stream.posts ).toEqual( [] ); expect( stream.glows ).toEqual( [] );
		expect( stream.allPostReservations ).toBe( reserved );
		expect( released.every( spy => spy.mock.calls.length === 1 ) ).toBe( true );
		expect( templateDisposal.every( spy => spy.mock.calls.length === 0 ) ).toBe( true );
		await stream.update( position );
		expect( stream.glows ).toEqual( before );
		expect( stream.glows.every( glow => before.includes( glow ) ) ).toBe( true );
		await stream.dispose();
		expect( templateDisposal.every( spy => spy.mock.calls.length === 1 ) ).toBe( true );
		expect( materialDispose ).not.toHaveBeenCalled();
		whole.dispose(); material.dispose();

	} );

	it( 'cancels detached preparation and retains its instance buffers until preparation settles', async () => {

		const { whole, stream, position } = setup();
		let finish, prepared, wanted;
		const prepare = vi.fn( ( group, state ) => {
			prepared = group; wanted = state.wanted;
			return new Promise( resolve => { finish = resolve; } );
		} );
		const first = stream.update( position, { radius: 0, prepare } );
		while ( ! finish ) await tick();
		expect( prepared.parent ).toBeNull();
		expect( stream.glows ).toHaveLength( 0 );
		expect( stream.update( position ) ).toBe( first );
		const disposed = prepared.children.map( mesh => vi.spyOn( mesh, 'dispose' ) );
		const next = stream.update( { x: 5000, z: 5000 } );
		expect( wanted() ).toBe( false );
		expect( disposed.every( spy => spy.mock.calls.length === 0 ) ).toBe( true );
		finish(); await next;
		expect( stream.group.children ).toHaveLength( 0 );
		expect( disposed.every( spy => spy.mock.calls.length === 1 ) ).toBe( true );
		await stream.dispose(); whole.dispose();

	} );

	it( 'admits collision before new visibility, drops pending posts and supports ports attached after initial admission', async () => {

		const { whole, stream, position } = setup();
		let finish;
		const collision = { addPosts: vi.fn( () => new Promise( resolve => { finish = resolve; } ) ), dropPosts: vi.fn() };
		const first = stream.update( position, { radius: 0, collision } );
		while ( ! finish ) await tick();
		expect( stream.posts ).toHaveLength( 0 );
		const [ id, posts ] = collision.addPosts.mock.calls[ 0 ];
		expect( posts.length ).toBeGreaterThan( 0 );
		stream.update( { x: 5000, z: 5000 } );
		expect( collision.dropPosts ).toHaveBeenCalledWith( id );
		finish( false ); await first;
		expect( stream.glows ).toHaveLength( 0 );

		await stream.update( position, { collision: null } );
		const prepare = vi.fn( async () => {} );
		collision.addPosts.mockImplementation( async () => true );
		await stream.update( position, { prepare, collision } );
		expect( prepare ).toHaveBeenCalledOnce();
		expect( collision.addPosts ).toHaveBeenCalledTimes( 2 );
		expect( stream.posts ).toEqual( posts );
		await stream.update( position );
		expect( prepare ).toHaveBeenCalledOnce();
		await stream.dispose(); whole.dispose();

	} );

	it.each( [ 'prepare', 'collision' ] )( 'rejects %s errors and releases the failed cell', async port => {

		const { whole, stream, position } = setup();
		const failure = async () => { throw new Error( 'fixture admission failed' ); };
		const collision = { addPosts: failure, dropPosts: vi.fn() };
		await expect( stream.update( position, { radius: 0, [ port ]: port === 'prepare' ? failure : collision } ) ).rejects.toThrow( 'fixture admission failed' );
		expect( stream.group.children ).toHaveLength( 0 );
		expect( stream.glows ).toHaveLength( 0 );
		if ( port === 'collision' ) expect( collision.dropPosts ).toHaveBeenCalledOnce();
		await stream.dispose(); whole.dispose();

	} );

	it( 'moves the collision window within resident rendering cells without duplicating border posts', async () => {

		const { whole, stream, position } = setup();
		const collision = { addPosts: vi.fn( async () => true ), dropPosts: vi.fn() };
		await stream.update( position, { radius: 70, collisionRadius: 0, collision } );
		const [ firstId, firstPosts ] = collision.addPosts.mock.calls[ 0 ];
		expect( collision.addPosts ).toHaveBeenCalledOnce();
		expect( stream.posts.length ).toBeGreaterThan( firstPosts.length );
		const other = stream.posts.find( post => ! firstPosts.includes( post ) );
		await stream.update( other );
		expect( collision.dropPosts ).toHaveBeenCalledWith( firstId );
		expect( collision.addPosts ).toHaveBeenCalledTimes( 2 );
		expect( collision.addPosts.mock.calls[ 1 ][ 1 ] ).toContain( other );
		expect( new Set( stream.posts ).size ).toBe( stream.posts.length );
		expect( stream.group.getObjectByName( firstId ) ).toBeDefined();
		await stream.dispose(); whole.dispose();

	} );

	it( 'rejects invalid spatial input before source planning', async () => {

		const { atlas } = streetLampFixture();
		const author = new StreetLamps( atlas, {} );
		expect( () => author.stream( { cellSize: 10000 } ) ).toThrow( 'E_STREET_FIXTURE_WINDOW' );
		const stream = author.stream();
		await expect( stream.update( { x: NaN, z: 0 } ) ).rejects.toThrow( 'E_STREET_FIXTURE_WINDOW' );
		await expect( stream.update( { x: 0, z: 0 }, { radius: - 1 } ) ).rejects.toThrow( 'E_STREET_FIXTURE_WINDOW' );
		expect( stream.stats.indexed ).toBe( 0 );
		await stream.dispose();

	} );

} );
