import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { GroundBuilder } from './GroundBuilder.js';

const rect = ( x, z, w, d ) => [ [ x, z ], [ x + w, z ], [ x + w, z + d ], [ x, z + d ] ];
const materials = new Map();
const factory = { build( key, variant ) {

	const id = `${key}:${variant}`;
	if ( ! materials.has( id ) ) materials.set( id, new THREE.MeshStandardMaterial( { name: id } ) );
	return materials.get( id );

} };

function fixture() {

	return { meta: { seed: 'stream' }, volumetric: { ground: [
		{ surface: 'roadway', polygon: rect( 0, - 4, 256, 3 ), bottom: - 0.2, top: 0 },
		{ surface: 'open', polygon: rect( 510, 500, 4, 4 ), bottom: 0, top: 0.2 },
		{ surface: 'sidewalk', moduleBlockId: 'a', polygon: rect( 0, 0, 256, 2 ), bottom: 0, top: 0.2 }
	] }, streets: { construction: { modules: { version: '1.0.0', definitions: [ { id: 'slab', parts: [
		{ role: 'joint', polygon: rect( 0, 0, 2, 1 ), bottom: 0, top: 0.18 },
		{ role: 'panel', polygon: rect( 0.006, 0.006, 1.988, 0.988 ), bottom: 0.18, top: 0.2 },
		{ role: 'gutter-lip', polygon: rect( 0, - 0.02, 2, 0.02 ), bottom: - 0.008, top: 0.02 }
	] } ], placements: [
		{ moduleId: 'slab', blockId: 'a', origin: [ 0, 0 ], turn: 0, count: 128, step: 2, finish: 'maintained' },
		{ moduleId: 'slab', blockId: 'b', origin: [ 500, 500 ], turn: 1, count: 16, step: 2, finish: 'maintained' }
	] } } } };

}

function collisionPort() {

	const bands = new Map();
	return { bands, addBand: vi.fn( async ( id, batches ) => { bands.set( id, [ ...batches ] ); return true; } ),
		dropBand: vi.fn( id => { bands.delete( id ); } ) };

}

describe( 'GroundBuilder spatial stream', () => {

	it( 'retains every source triangle once across tiles and shares module templates with bounded collision pieces', async () => {

		const atlas = fixture(), original = structuredClone( atlas );
		const eager = new GroundBuilder( atlas, factory ).build();
		const stream = new GroundBuilder( atlas, factory ).stream( { cellSize: 32 } ), collision = collisionPort();
		await stream.update( { x: 250, z: 250 }, { radius: 1000, collision } );
		const pieces = [ ...collision.bands.values() ].flat();
		for ( const piece of pieces ) {

			expect( piece.length % 9 ).toBe( 0 );
			expect( piece.length ).toBeLessThanOrEqual( 2048 * 9 );

		}
		expect( canonical( pieces ) ).toEqual( canonical( [ eager.colliderGeometry.toNonIndexed().attributes.position.array ] ) );
		expect( stream.stats ).toMatchObject( { resident: stream.stats.indexed, collision: stream.stats.indexed, pending: false } );
		expect( rendered( stream.group ) ).toEqual( rendered( eager.group ) );
		expect( stream.group.children.length ).toBeLessThanOrEqual( materials.size );
		const repeats = stream.group.children.filter( mesh => mesh.instanceCount >= 144 );
		expect( repeats.length ).toBeGreaterThan( 0 );
		for ( const mesh of repeats ) {

			expect( mesh.isBatchedMesh ).toBe( true );
			expect( mesh.perObjectFrustumCulled ).toBe( true );
			const ids = new Set();
			for ( let i = 0; i < mesh.instanceCount; i ++ ) ids.add( mesh.getGeometryIdAt( i ) );
			expect( ids.size ).toBeLessThan( 10 );

		}
		const buffers = new Map( stream.group.children.map( mesh => [ mesh, mesh.geometry ] ) );
		await stream.update( { x: 0, z: 0 }, { radius: 16 } );
		await stream.update( { x: 250, z: 250 }, { radius: 1000 } );
		expect( rendered( stream.group ) ).toEqual( rendered( eager.group ) );
		for ( const mesh of stream.group.children ) expect( mesh.geometry ).toBe( buffers.get( mesh ) );
		expect( atlas ).toEqual( original );
		stream.dispose();
		expect( collision.bands.size ).toBe( 0 );
		expect( stream.group.children ).toHaveLength( 0 );

	} );

	it( 'attaches ports to resident tiles and limits collision independently of the visible distance', async () => {

		const stream = new GroundBuilder( fixture(), factory ).stream( { cellSize: 32 } );
		await stream.update( { x: 0, z: 0 }, { radius: 1000, collisionRadius: 0 } );
		const groups = [ ...stream.group.children ], collision = collisionPort(), prepare = vi.fn( async () => {} );
		await stream.update( { x: 0, z: 0 }, { collision, prepare } );
		expect( stream.group.children ).toEqual( groups );
		expect( prepare ).toHaveBeenCalledOnce();
		expect( collision.addBand.mock.calls.length ).toBeGreaterThan( 0 );
		expect( collision.addBand.mock.calls.length ).toBeLessThan( stream.stats.resident );
		for ( let i = 0; i < 100; i ++ ) await stream.update( { x: 1, z: 1 } );
		expect( prepare ).toHaveBeenCalledOnce();
		expect( collision.addBand.mock.calls.length ).toBe( collision.bands.size );
		stream.dispose();

	} );

	it( 'coalesces movement during preparation and releases obsolete tiles before the latest window settles', async () => {

		const stream = new GroundBuilder( fixture(), factory ).stream( { cellSize: 32 } );
		let release, oldGroup, wanted;
		const first = new Promise( resolve => { release = resolve; } );
		const prepare = vi.fn( async ( group, state ) => {

			if ( ! oldGroup ) { oldGroup = group; wanted = state.wanted; await first; }

		} );
		const initial = stream.update( { x: 0, z: 0 }, { radius: 16, prepare } );
		await vi.waitFor( () => expect( prepare ).toHaveBeenCalledOnce() );
		expect( rendered( stream.group ) ).toHaveLength( 0 );
		expect( stream.update( { x: 1, z: 1 } ) ).toBe( initial );
		const moved = stream.update( { x: 500, z: 500 } );
		expect( moved ).toBe( initial );
		expect( wanted() ).toBe( false );
		expect( rendered( stream.group ) ).toHaveLength( 0 );
		release();
		await moved;
		expect( stream.group.children.length ).toBeGreaterThan( 0 );
		expect( rendered( stream.group ).length ).toBeGreaterThan( 0 );
		expect( stream.stats.resident ).toBeLessThan( stream.stats.indexed );
		stream.dispose();

	} );

	it( 'cancels pending collision on disposal and reports an admission failure without publishing the tile', async () => {

		const stream = new GroundBuilder( fixture(), factory ).stream( { cellSize: 32 } );
		let cancel;
		const collision = { addBand: vi.fn( () => new Promise( resolve => { cancel = resolve; } ) ), dropBand: vi.fn( () => cancel?.( false ) ) };
		const pending = stream.update( { x: 0, z: 0 }, { radius: 16, collision } );
		await vi.waitFor( () => expect( collision.addBand ).toHaveBeenCalledOnce() );
		stream.dispose();
		await pending;
		expect( collision.dropBand ).toHaveBeenCalled();
		expect( stream.group.children ).toHaveLength( 0 );
		expect( () => stream.update( { x: 0, z: 0 } ) ).toThrow( expect.objectContaining( { code: 'E_GROUND_STREAM' } ) );
		const failed = new GroundBuilder( fixture(), factory ).stream();
		await expect( failed.update( { x: 0, z: 0 }, { collision: { addBand: async () => { throw new Error( 'cook failed' ); }, dropBand() {} } } ) ).rejects.toThrow( 'cook failed' );
		expect( failed.stats.resident ).toBe( 0 );
		expect( failed.group.children ).toHaveLength( 0 );
		failed.dispose();

	} );

	it( 'rejects invalid spatial input before material creation', () => {

		const build = vi.fn();
		const invalid = fixture();
		invalid.streets.construction.modules.definitions[ 0 ].parts[ 0 ].role = 'unknown';
		expect( () => new GroundBuilder( invalid, { build } ).stream() ).toThrow( expect.objectContaining( { code: 'E_GROUND_CONSTRUCTION' } ) );
		const builder = new GroundBuilder( fixture(), { build } );
		expect( () => builder.stream( { cellSize: 0 } ) ).toThrow( expect.objectContaining( { code: 'E_GROUND_STREAM' } ) );
		const stream = builder.stream();
		for ( const [ position, options ] of [ [ { x: NaN, z: 0 }, {} ], [ { x: 0, z: 0 }, { radius: - 1 } ], [ { x: 0, z: 0 }, { radius: 16, collisionRadius: 32 } ] ] ) {

			expect( () => stream.update( position, options ) ).toThrow( expect.objectContaining( { code: 'E_GROUND_STREAM' } ) );

		}
		expect( build ).not.toHaveBeenCalled();
		stream.dispose();

	} );

} );

function canonical( arrays ) {

	const triangles = [];
	for ( const data of arrays ) for ( let i = 0; i < data.length; i += 9 ) triangles.push( Array.from( data.subarray( i, i + 9 ), value => Math.round( value * 1e5 ) / 1e5 ).join( ',' ) );
	return triangles.sort();

}

/** Compare visible triangles, physical UVs, normals and material identity through Three's public geometry API. */
function rendered( group ) {

	const triangles = [], point = new THREE.Vector3(), normal = new THREE.Vector3();
	const transform = new THREE.Matrix4(), instance = new THREE.Matrix4(), normalMatrix = new THREE.Matrix3();
	group.updateMatrixWorld( true );
	group.traverse( mesh => {

		if ( ! mesh.isMesh ) return;
		const geometry = mesh.geometry, positions = geometry.getAttribute( 'position' ), normals = geometry.getAttribute( 'normal' ), uvs = geometry.getAttribute( 'uv' );
		const count = mesh.isBatchedMesh ? mesh.maxInstanceCount : mesh.isInstancedMesh ? mesh.count : 1;
		for ( let copy = 0; copy < count; copy ++ ) {

			let start = 0, size = geometry.index?.count ?? positions.count;
			transform.copy( mesh.matrixWorld );
			if ( mesh.isBatchedMesh ) {

				try { if ( ! mesh.getVisibleAt( copy ) ) continue; } catch { continue; }
				const range = mesh.getGeometryRangeAt( mesh.getGeometryIdAt( copy ), {} );
				start = range.indexStart; size = range.indexCount;

			}
			if ( mesh.isBatchedMesh || mesh.isInstancedMesh ) { mesh.getMatrixAt( copy, instance ); transform.multiply( instance ); }
			normalMatrix.getNormalMatrix( transform );
			for ( let i = start; i < start + size; i += 3 ) {

				const values = [ mesh.material.uuid ];
				for ( let j = 0; j < 3; j ++ ) {

					const index = geometry.index ? geometry.index.getX( i + j ) : i + j;
					point.fromBufferAttribute( positions, index ).applyMatrix4( transform );
					normal.fromBufferAttribute( normals, index ).applyMatrix3( normalMatrix );
					values.push( ...[ ...point, ...normal, uvs.getX( index ), uvs.getY( index ) ].map( value => Math.round( value * 1e5 ) / 1e5 ) );

				}
				triangles.push( values.join( ',' ) );

			}

		}

	} );
	return triangles.sort();

}
