import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { MaterialBatches } from './MaterialBatches.js';

/** A loader style primitive: its own draw range over a buffer it shares with a neighbour. */
function shared( { vertices, drawn, offset = 0 } ) {

	const positions = new Float32Array( vertices * 3 );
	for ( let i = 0; i < vertices; i ++ ) positions.set( [ i, i + 0.5, i + 0.25 ], i * 3 );

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'normal', new THREE.BufferAttribute( new Float32Array( vertices * 3 ).fill( 1 ), 3 ) );
	geometry.setIndex( Array.from( { length: drawn }, ( unused, i ) => offset + ( i % 3 ) ) );

	return geometry;

}

function plain( vertices ) {

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.BufferAttribute( new Float32Array( vertices * 3 ).fill( 2 ), 3 ) );
	geometry.setAttribute( 'normal', new THREE.BufferAttribute( new Float32Array( vertices * 3 ).fill( 1 ), 3 ) );

	return geometry;

}

describe( 'the batching class takes primitives as a loader publishes them', () => {

	it( 'batches one bucket that mixes an indexed primitive with a non indexed one', () => {

		const material = new THREE.MeshStandardMaterial();
		const indexed = shared( { vertices: 3, drawn: 3 } );
		const flat = plain( 6 );
		const batches = new MaterialBatches( 'mixed' ).add( [
			{ id: 'a', surfaces: [ { bucket: 'stone', geometry: indexed, material } ] },
			{ id: 'b', surfaces: [ { bucket: 'stone', geometry: flat, material } ] }
		] );

		expect( batches.batchCount ).toBe( 1 );

		const handle = batches.admit( 'b', new THREE.Matrix4().setPosition( 3, 0, 0 ) );
		const batch = handle.parts[ 0 ].batch;

		expect( batch.mesh.getGeometryIdAt( handle.instances[ 0 ] ) ).toBe( handle.parts[ 0 ].geometryId );
		expect( batch.mesh.getMatrixAt( handle.instances[ 0 ], new THREE.Matrix4() ).elements[ 12 ] ).toBeCloseTo( 3, 5 );
		batches.release( handle );
		expect( batches.instanceCount ).toBe( 0 );
		batches.dispose();

	} );

	it( 'carries only the vertices a primitive draws, and leaves a compacted one alone', () => {

		const material = new THREE.MeshStandardMaterial();
		// Three of the twelve vertices are this primitive's; the rest belong to the
		// primitives beside it in the same loader buffer.
		const carried = shared( { vertices: 12, drawn: 3 } );
		const already = shared( { vertices: 3, drawn: 6 } );
		const surfaces = [ carried, already ].map( ( geometry ) => ( { bucket: 'stone', geometry, material } ) );
		const batches = new MaterialBatches( 'shared' ).add( [
			{ id: 'a', surfaces: [ surfaces[ 0 ] ] },
			{ id: 'b', surfaces: [ surfaces[ 1 ] ] }
		] );

		const [ a, b ] = [ 'a', 'b' ].map( ( id ) => batches.entries.get( id )[ 0 ] );

		expect( a.batch.mesh.getGeometryRangeAt( a.geometryId ).vertexCount ).toBe( 3 );
		expect( b.batch.mesh.getGeometryRangeAt( b.geometryId ).vertexCount ).toBe( 3 );
		// The owner reads the compacted geometry back; one that already draws every
		// vertex it holds is handed over untouched.
		expect( surfaces[ 0 ].geometry ).not.toBe( carried );
		expect( surfaces[ 1 ].geometry ).toBe( already );
		batches.dispose();

	} );

	it( 'takes an entry handed over later into the batch its material already has, growing its buffers once', () => {

		const material = new THREE.MeshStandardMaterial();
		const batches = new MaterialBatches( 'later' )
			.add( [ { id: 'a', surfaces: [ { bucket: 'stone', geometry: plain( 3 ), material } ] } ] );

		const standing = batches.admit( 'a', new THREE.Matrix4().setPosition( 4, 0, 0 ) );
		const batch = standing.parts[ 0 ].batch;
		const room = batch.vertexCapacity;

		batches.add( [ { id: 'b', surfaces: [ { bucket: 'stone', geometry: plain( 30 ), material } ] } ] );

		// The material keeps its one draw, its buffers hold both entries, and a
		// growth that runs out doubles rather than fitting each entry exactly.
		expect( batches.batchCount ).toBe( 1 );
		expect( batch.vertices ).toBe( 33 );
		expect( batch.vertexCapacity ).toBeGreaterThanOrEqual( room * 2 );

		// The copy standing through the growth still draws what it was drawing.
		const later = batches.admit( 'b', new THREE.Matrix4().setPosition( 9, 0, 0 ) );
		expect( batch.mesh.getMatrixAt( standing.instances[ 0 ], new THREE.Matrix4() ).elements[ 12 ] ).toBeCloseTo( 4, 5 );
		expect( batch.mesh.getGeometryRangeAt( standing.parts[ 0 ].geometryId ).vertexCount ).toBe( 3 );
		expect( batch.mesh.getGeometryRangeAt( later.parts[ 0 ].geometryId ).vertexCount ).toBe( 30 );
		batches.dispose();

	} );

	it( 'rebuilds the draws whenever it replaces the buffers they were built from', () => {

		const material = new THREE.MeshStandardMaterial();
		const batches = new MaterialBatches( 'growing' )
			.add( [ { id: 'a', surfaces: [ { bucket: 'stone', geometry: plain( 3 ), material } ] } ], { instances: 1 } );
		const rebuilt = vi.fn();
		material.addEventListener( 'dispose', rebuilt );

		const first = batches.admit( 'a', new THREE.Matrix4(), new THREE.Color( 1, 0, 0 ) );
		// The colour texture is born here, and the draws that were built without it.
		expect( rebuilt ).toHaveBeenCalledTimes( 1 );

		const batch = first.parts[ 0 ].batch;
		const capacity = batch.capacity;
		batches.admit( 'a', new THREE.Matrix4().setPosition( 9, 0, 0 ), new THREE.Color( 0, 1, 0 ) );

		expect( batch.capacity ).toBeGreaterThan( capacity );
		expect( rebuilt ).toHaveBeenCalledTimes( 2 );
		expect( batch.mesh.getMatrixAt( first.instances[ 0 ], new THREE.Matrix4() ).elements[ 12 ] ).toBeCloseTo( 0, 5 );
		batches.dispose();

	} );

} );
