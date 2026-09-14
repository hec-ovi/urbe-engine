import { describe, expect, it, vi } from 'vitest';
import { MeshBasicMaterial } from 'three/webgpu';
import { NativeStreetStream } from './NativeStreetStream.js';

// Independent minimal producer GLB: a road and a noncolliding coating, both rebased by one node transform.
function streetFixture( { tagged = true, vertexX = 4 } = {} ) {
	const data = new Float32Array( [ 0, 0, 0, 0, 0, 4, vertexX, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 4, 4, 0, 0, 0, 0, 0, 0, 0 ] );
	const document = {
		asset: { version: '2.0' }, scene: 0, scenes: [ { nodes: [ 0, 1 ] } ], buffers: [ { byteLength: data.byteLength } ],
		bufferViews: [ [ 0, 36 ], [ 36, 36 ], [ 72, 24 ], [ 96, 12 ], [ 108, 12 ] ].map( ( [ byteOffset, byteLength ] ) => ( { buffer: 0, byteOffset, byteLength } ) ),
		accessors: [ 'VEC3', 'VEC3', 'VEC2', 'SCALAR', 'SCALAR' ].map( ( type, bufferView ) => ( {
			bufferView, componentType: 5126, count: 3, type, ...( bufferView === 0 ? { min: [ 0, 0, 0 ], max: [ 4, 0, 4 ] } : {} )
		} ) ),
		materials: [ 'asphalt', 'whitePaint' ].map( streetNativeSurface => ( { extras: { streetNativeSurface } } ) ),
		meshes: [ 0, 1 ].map( material => ( { primitives: [ { attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, _STREET_WEAR: 3, _STREET_HEIGHT: 4 }, material } ] } ) ),
		nodes: [ 0, 1 ].map( mesh => ( { mesh, translation: [ 128, mesh * 0.005, 0 ], extras: tagged ? { streetCollision: mesh === 0 } : {} } ) )
	};
	const json = new TextEncoder().encode( JSON.stringify( document ) ), size = Math.ceil( json.length / 4 ) * 4;
	const bytes = new ArrayBuffer( 28 + size + data.byteLength ), view = new DataView( bytes );
	[ 0x46546c67, 2, bytes.byteLength, size, 0x4e4f534a ].forEach( ( value, i ) => view.setUint32( i * 4, value, true ) );
	new Uint8Array( bytes, 20, size ).fill( 32 ); new Uint8Array( bytes, 20, json.length ).set( json );
	view.setUint32( 20 + size, data.byteLength, true ); view.setUint32( 24 + size, 0x004e4942, true );
	new Uint8Array( bytes, 28 + size ).set( new Uint8Array( data.buffer ) );
	const piece = { id: 'cell', bounds: { min: [ 128, 0, 0 ], max: [ 132, 0.005, 4 ] }, origin: [ 128, 0, 0 ],
		triangles: 2, surfaceIds: [ 'asphalt', 'whitePaint' ], hasCollision: true };
	const source = { manifest: { pieces: [ piece ] }, readPiece: vi.fn( async () => bytes ) };
	const material = new MeshBasicMaterial();
	const materials = { build: vi.fn( () => material ), assertGeometry: vi.fn(), resources: () => [] };
	return { source, materials, material };
}

describe( 'native street runtime', () => {
	it( 'loads original GLB transforms, warms before visibility, collides only physical triangles and releases an evicted cell', async () => {
		const data = streetFixture(), stream = new NativeStreetStream( data.source, data.materials );
		const triangles = [];
		const collision = { addBand: vi.fn( async ( id, batches ) => { for ( const batch of batches ) triangles.push( ...batch ); return true; } ), dropBand: vi.fn() };
		const prepare = vi.fn( async group => { expect( group.parent ).toBeNull(); } );
		await stream.update( { x: 130, z: 2 }, { radius: 30, collisionRadius: 15, collision, prepare } );
		expect( triangles ).toEqual( [ 128, 0, 0, 128, 0, 4, 132, 0, 0 ] );
		expect( stream.group.children ).toHaveLength( 1 );
		expect( data.materials.build.mock.calls.map( args => args[ 0 ] ) ).toEqual( [ 'asphalt', 'whitePaint' ] );
		expect( data.materials.assertGeometry ).toHaveBeenCalledTimes( 2 );
		await stream.update( { x: 131, z: 2 } );
		expect( data.source.readPiece ).toHaveBeenCalledOnce();
		expect( prepare ).toHaveBeenCalledOnce();
		const release = vi.fn(); stream.group.traverse( mesh => mesh.geometry?.addEventListener( 'dispose', release ) );
		await stream.update( { x: 500, z: 500 } );
		expect( collision.dropBand ).toHaveBeenCalledWith( 'native-street:cell' );
		expect( stream.group.children ).toHaveLength( 0 ); expect( release ).toHaveBeenCalled();
		stream.dispose(); expect( () => stream.update( { x: 0, z: 0 } ) ).toThrow( /disposed/ );
	} );

	it( 'awaits material readiness and cancels pending visibility when disposed', async () => {
		const data = streetFixture(); let resolve;
		// Both surfaces share the same loading resource.
		const resource = { ready: new Promise( ready => { resolve = ready; } ) }; data.materials.resources = () => [ resource ];
		const stream = new NativeStreetStream( data.source, data.materials );
		const pending = stream.update( { x: 130, z: 0 } );
		await vi.waitFor( () => expect( data.materials.build ).toHaveBeenCalledTimes( 2 ) );
		expect( stream.group.children ).toHaveLength( 0 ); stream.dispose(); resolve(); await pending;
		expect( stream.group.children ).toHaveLength( 0 );
	} );

	it( 'keeps a piece detached until its current preparation port finishes', async () => {
		const data = streetFixture(), stream = new NativeStreetStream( data.source, data.materials );
		let finishFirst, finishCurrent;
		const first = vi.fn( () => new Promise( resolve => { finishFirst = resolve; } ) );
		const current = vi.fn( () => new Promise( resolve => { finishCurrent = resolve; } ) );
		const pending = stream.update( { x: 130, z: 0 }, { prepare: first } );
		await vi.waitFor( () => expect( first ).toHaveBeenCalledOnce() );
		const latest = stream.update( { x: 130, z: 0 }, { prepare: current } );
		expect( latest ).toBe( pending );
		finishFirst();
		await vi.waitFor( () => expect( current ).toHaveBeenCalledOnce() );
		expect( stream.group.children ).toHaveLength( 0 );
		expect( current.mock.calls[ 0 ][ 0 ].parent ).toBeNull();
		finishCurrent(); await latest;
		expect( stream.group.children ).toHaveLength( 1 );
		stream.dispose();
	} );

	it( 'rejects invalid decoded geometry, failed source reads and invalid windows', async () => {
		const absent = streetFixture( { tagged: false } );
		await expect( new NativeStreetStream( absent.source, absent.materials ).update( { x: 130, z: 0 } ) ).rejects.toMatchObject( { code: 'E_NATIVE_STREET_STREAM' } );
		const count = streetFixture(); count.source.manifest.pieces[ 0 ].triangles = 3;
		await expect( new NativeStreetStream( count.source, count.materials ).update( { x: 130, z: 0 } ) ).rejects.toThrow( /differs from manifest/ );
		for ( const vertexX of [ 40, NaN ] ) {
			const bounds = streetFixture( { vertexX } );
			await expect( new NativeStreetStream( bounds.source, bounds.materials ).update( { x: 130, z: 0 } ) ).rejects.toThrow( /decoded bounds differ/ );
		}
		const failed = streetFixture(); failed.source.readPiece.mockRejectedValue( new Error( 'asset unavailable' ) );
		const stream = new NativeStreetStream( failed.source, failed.materials );
		await expect( stream.update( { x: 130, z: 0 } ) ).rejects.toThrow( /asset unavailable/ );
		expect( () => stream.update( { x: 0, z: 0 }, { radius: 5, collisionRadius: 6 } ) ).toThrow( /Invalid street window/ );
	} );
} );
