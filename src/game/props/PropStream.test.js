import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Dressing } from './Dressing.js';

let fixture;
const resources = [];
beforeAll( async () => {
	const bytes = await readFile( new URL( './fixtures/static.glb', import.meta.url ) );
	fixture = bytes.buffer.slice( bytes.byteOffset, bytes.byteOffset + bytes.byteLength );
} );
afterAll( () => { for ( const resource of resources ) resource.dispose(); } );
function dressing( atlas = world(), options = {} ) {
	const material = new THREE.MeshStandardMaterial(); resources.push( material );
	return new Dressing( atlas, { edges: [] }, { build: () => material }, { loadAsset: () => new GLTFLoader().parseAsync( fixture, '' ), ...options } );
}

it( 'preserves global placements and exact nearby render/collision triangles through eviction and reentry', async () => {
	const atlas = world();
	const complete = await dressing( atlas ).build();
	const loadAsset = vi.fn( () => new GLTFLoader().parseAsync( fixture, '' ) );
	const stream = await dressing( atlas, { loadAsset } ).stream( { cellSize: 64 } );
	expect( stream.placements.map( serialize ) ).toEqual( complete.placements.map( serialize ) );
	expect( stream.counts ).toEqual( complete.counts );
	expect( stream.stats ).toMatchObject( { indexed: 36, resident: 0, collision: 0, draws: 0 } );
	const geometry = collision();
	const prepare = vi.fn( async ( group, { wanted } ) => {
		expect( wanted() ).toBe( true );
		expect( group.parent ).toBeNull();
	} );
	await stream.update( { x: 0, z: 0 }, { radius: 100, collisionRadius: 100, prepare, collision: geometry } );
	expect( stream.stats ).toMatchObject( { resident: 18, collision: 18, pending: false } );
	const sharedGeometry = stream.group.children[ 0 ].children[ 0 ].geometry;
	const disposeGeometry = vi.spyOn( sharedGeometry, 'dispose' );
	expect( rendered( stream.group ) ).toEqual( rendered( complete.group, matrix => matrix.elements[ 12 ] < 200 ) );
	expect( faces( [ ...geometry.parts.values() ].flat() ) ).toEqual( faces( [ complete.colliders.get( 'props' ).attributes.position.array ], x => x < 200 ) );
	const nearIds = identities( stream.group );
	const nearBands = [ ...geometry.parts.keys() ];
	await stream.update( { x: 1000, z: 0 } );
	expect( stream.stats ).toMatchObject( { resident: 18, collision: 18 } );
	expect( identities( stream.group ).some( id => nearIds.includes( id ) ) ).toBe( false );
	for ( const id of nearBands ) expect( geometry.parts.has( id ) ).toBe( false );
	await stream.update( { x: 0, z: 0 } );
	expect( identities( stream.group ) ).toEqual( nearIds );
	await stream.update( { x: 0, z: 0 }, { radius: 2000 } );
	expect( stream.stats.resident ).toBe( 36 );
	expect( stream.stats.draws ).toBeLessThan( complete.group.children.length );
	expect( stream.stats.draws ).toBeLessThanOrEqual( 9 );
	expect( loadAsset ).toHaveBeenCalledTimes( 5 );
	expect( disposeGeometry ).not.toHaveBeenCalled();
	stream.dispose(); stream.dispose(); complete.dispose();
	expect( disposeGeometry ).toHaveBeenCalledTimes( 1 );
	expect( geometry.parts.size ).toBe( 0 );
	expect( stream.group.children ).toHaveLength( 0 );
} );

it( 'coalesces updates and cancels obsolete preparation before adding visibility or collision', async () => {
	const stream = await dressing().stream();
	let release;
	const blocked = new Promise( resolve => { release = resolve; } );
	const prepare = vi.fn( async () => { if ( prepare.mock.calls.length === 1 ) await blocked; } );
	const geometry = collision();
	const pending = stream.update( { x: 0, z: 0 }, { radius: 100, collisionRadius: 100, prepare, collision: geometry } );
	await vi.waitFor( () => expect( prepare ).toHaveBeenCalledTimes( 1 ) );
	expect( stream.group.children ).toHaveLength( 0 );
	const latest = stream.update( { x: 1000, z: 0 } );
	expect( latest ).toBe( pending ); release(); await pending;
	expect( stream.stats ).toMatchObject( { resident: 18, collision: 18, pending: false } );
	expect( identities( stream.group ).every( id => Number( id.split( ':' )[ 1 ] ) >= 6 ) ).toBe( true );
	stream.dispose();
} );

it( 'accepts late preparation/collision ports, retries failures and cancels pending admission on disposal', async () => {
	const stream = await dressing().stream();
	await stream.update( { x: 0, z: 0 }, { radius: 100, collisionRadius: 100 } );
	const prepare = vi.fn( async () => {} );
	const geometry = collision();
	geometry.addBand.mockRejectedValueOnce( new Error( 'cook failed' ) );
	await expect( stream.update( { x: 0, z: 0 }, { prepare, collision: geometry } ) ).rejects.toThrow( 'cook failed' );
	await stream.update( { x: 0, z: 0 } );
	expect( prepare ).toHaveBeenCalled(); expect( stream.stats.collision ).toBe( 18 );
	let release;
	const blocked = new Promise( resolve => { release = resolve; } );
	const waiting = vi.fn( () => blocked );
	const pending = stream.update( { x: 1000, z: 0 }, { prepare: waiting } );
	await vi.waitFor( () => expect( waiting ).toHaveBeenCalled() );
	stream.dispose(); release(); await pending;
	expect( stream.group.children ).toHaveLength( 0 ); expect( geometry.parts.size ).toBe( 0 );
	await expect( stream.update( { x: 0, z: 0 } ) ).rejects.toMatchObject( { code: 'E_PROP_STREAM' } );
} );

it( 'validates stream settings before loading assets and refuses invalid windows', async () => {
	const loadAsset = vi.fn();
	await expect( dressing( world(), { loadAsset } ).stream( { cellSize: 0 } ) ).rejects.toMatchObject( { code: 'E_PROP_STREAM' } );
	expect( loadAsset ).not.toHaveBeenCalled();
	const stream = await dressing().stream();
	await expect( stream.update( { x: NaN, z: 0 } ) ).rejects.toMatchObject( { code: 'E_PROP_STREAM' } );
	await expect( stream.update( { x: 0, z: 0 }, { radius: - 1 } ) ).rejects.toMatchObject( { code: 'E_PROP_STREAM' } );
	stream.dispose();
} );

function serialize( item ) { return { ...item, matrix: item.matrix.toArray() }; }
function identities( group ) {
	const ids = new Set(); group.traverse( mesh => { for ( const id of mesh.userData.propIds ?? [] ) ids.add( id ); } );
	return [ ...ids ].sort();
}
function collision() {
	const parts = new Map();
	return { parts, addBand: vi.fn( async ( id, chunks ) => {
		const copy = [];
		for ( const chunk of chunks ) { expect( chunk.length ).toBeLessThanOrEqual( 2048 * 9 ); copy.push( chunk.slice() ); }
		parts.set( id, copy ); return true;
	} ), dropBand: vi.fn( id => parts.delete( id ) ) };
}
function rendered( group, include = () => true ) {
	const parts = [], matrix = new THREE.Matrix4(), vertex = new THREE.Vector3();
	group.traverse( mesh => {
		if ( ! mesh.isInstancedMesh ) return;
		for ( let i = 0; i < mesh.count; i ++ ) {
			mesh.getMatrixAt( i, matrix ); if ( ! include( matrix ) ) continue;
			const geometry = mesh.geometry, position = geometry.attributes.position, index = geometry.index;
			const points = new Float32Array( ( index?.count ?? position.count ) * 3 );
			for ( let n = 0; n < points.length / 3; n ++ ) vertex.fromBufferAttribute( position, index ? index.getX( n ) : n ).applyMatrix4( matrix ).toArray( points, n * 3 );
			parts.push( points );
		}
	} );
	return faces( parts );
}
function faces( parts, include = () => true ) {
	const result = [];
	for ( const points of parts ) for ( let i = 0; i < points.length; i += 9 ) {
		if ( ! include( points[ i ] ) ) continue;
		result.push( Array.from( points.subarray( i, i + 9 ) ).map( Math.fround ).join( ',' ) );
	}
	return result.sort();
}
function world() {
	const rect = ( x, z, w, d ) => [ [ x, z ], [ x + w, z ], [ x + w, z + d ], [ x, z + d ] ];
	const definition = { id: 'rail', parts: [
		{ role: 'guardrail', polygon: rect( 0, - 0.07, 0.09, 0.14 ), bottom: 0.2, top: 1.2 },
		{ role: 'guardrail', polygon: rect( 1.91, - 0.07, 0.09, 0.14 ), bottom: 0.2, top: 1.2 },
		{ role: 'guardrail', polygon: rect( 0, - 0.03, 2, 0.06 ), bottom: 1.12, top: 1.2 }
	] };
	return { meta: { seed: 'streamed-rails' }, parcels: [], districts: [], transit: {}, volumetric: { ground: [] },
		streets: { planting: [], construction: { modules: { definitions: [ definition ], placements: Array.from( { length: 12 }, ( _, i ) => ( {
			moduleId: 'rail', blockId: `b${i}`, origin: [ ( i < 6 ? 0 : 1000 ) + ( i % 6 ) * 10, 0 ], turn: i % 4, count: 3, step: 2
		} ) ) } } }
	};
}
