import { expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { GroundBuilder } from './GroundBuilder.js';

// A complete road owner from the generated regular fitted city. Its encoded
// boundary is simple, but triangulating its source coordinates reverses a face.
const polygon = [
	[ 139.747, 268.635 ], [ 139.74970076316552, 268.638469912546 ], [ 140.056, 269.032 ],
	[ 140.23134488020526, 269.1648237467555 ], [ 140.456, 269.335 ], [ 140.922, 269.524 ],
	[ 141.42, 269.586 ], [ 141.70187894476942, 269.54694448355605 ], [ 141.918, 269.517 ],
	[ 142.381, 269.321 ], [ 141.36003706823925, 269.92004692502104 ], [ 141.15198716926994, 270.042119576585 ],
	[ 140.85007341726086, 270.2192665611975 ], [ 140.72166987381453, 270.29460695355704 ], [ 140.721, 270.295 ],
	[ 140.64571019662478, 270.1666826759724 ], [ 140.4685632118244, 269.8647689236432 ], [ 140.34600761758333, 269.6558959396184 ]
];

it.each( [ false, true ] )( 'covers the actual encoded owner with complete edge stations (fitted=%s)', fitted => {
	const atlas = fixture( polygon, fitted );
	const snapshot = structuredClone( atlas );
	const material = new THREE.MeshStandardMaterial();
	const { group, colliderGeometry } = new GroundBuilder( atlas, { build: () => material } ).build();
	for ( const geometry of [ group.children.find( object => object.isMesh ).geometry, colliderGeometry ] ) coverage( geometry, polygon );
	expect( atlas ).toEqual( snapshot );
	group.traverse( object => object.geometry?.dispose() );
	colliderGeometry.dispose();
	material.dispose();
} );

it.each( [ false, true ] )( 'retains collinear canonical stations as incident boundary edges (reversed=%s)', reversed => {
	const ring = [ [ 200, 100 ], [ 201, 100 ], [ 202, 100 ], [ 203, 100 ], [ 203, 101 ],
		[ 203, 102 ], [ 202, 102 ], [ 201, 102 ], [ 200, 102 ], [ 200, 101 ] ];
	if ( reversed ) ring.reverse();
	const material = new THREE.MeshStandardMaterial();
	const { group, colliderGeometry } = new GroundBuilder( fixture( ring, true ), { build: () => material } ).build();
	coverage( group.children[ 0 ].geometry, ring );
	coverage( colliderGeometry, ring );
	group.traverse( object => object.geometry?.dispose() );
	colliderGeometry.dispose();
	material.dispose();
} );

it( 'reports a triangulator failure instead of publishing incomplete encoded coverage', () => {
	const triangulate = vi.spyOn( THREE.ShapeUtils, 'triangulateShape' ).mockReturnValue( [] );
	try {
		expect( () => new GroundBuilder( fixture( polygon, false ), { build: () => null } ).build() )
			.toThrow( expect.objectContaining( { code: 'E_GROUND_TRIANGULATION' } ) );
	} finally {
		triangulate.mockRestore();
	}
} );

function fixture( ring, fitted ) {
	const cover = { surface: 'roadway', bottom: - 0.2, top: 0, polygon: ring };
	const atlas = { volumetric: { ground: [ cover ] } };
	if ( fitted ) {
		cover.surface = 'sidewalk';
		cover.top = 0.15;
		cover.bottom = 0;
		cover.construction = { regionId: 'region', part: { kind: 'solid', role: 'approach' } };
		atlas.streets = { construction: { paving: { version: '1.1.0', roadwayLayoutId: 'layout',
			layouts: [ { id: 'layout', familyId: 'maintained', modules: [] } ],
			frames: [ { id: 'frame', origin: [ 130.6861475849036, 272.705403517185 ], u: [ 0.5060889003890103, 0.8624813185820561 ], gridStep: 0.001 } ],
			sources: [ { id: 'source', surface: cover.surface, bottom: cover.bottom, top: cover.top } ],
			regions: [ { id: 'region', frameId: 'frame', layoutId: 'layout', sourceId: 'source', band: 'circulation' } ]
		} } };
	}
	return atlas;
}

function coverage( geometry, source ) {
	const ring = source.map( point => point.map( Math.fround ) );
	const positions = geometry.getAttribute( 'position' );
	const indices = geometry.index?.array ?? Array.from( { length: positions.count }, ( _, i ) => i );
	const edges = new Map(), balances = new Map();
	let area = 0;
	for ( let i = 0; i < indices.length; i += 3 ) {
		const triangle = [ 0, 1, 2 ].map( offset => [ positions.getX( indices[ i + offset ] ), positions.getZ( indices[ i + offset ] ) ] );
		const signed = cross( ...triangle );
		expect( signed, JSON.stringify( triangle ) ).toBeLessThan( 0 );
		area -= signed;
		for ( let j = 0; j < 3; j ++ ) {
			const key = edge( triangle[ j ], triangle[ ( j + 1 ) % 3 ] );
			edges.set( key, ( edges.get( key ) ?? 0 ) + 1 );
			const sign = triangle[ j ].join( ',' ) < triangle[ ( j + 1 ) % 3 ].join( ',' ) ? 1 : - 1;
			balances.set( key, ( balances.get( key ) ?? 0 ) + sign );
		}
	}
	// Positive faces plus exact boundary incidence and area prove a disk with
	// the authored outline, not a signed-area cancellation around a bad face.
	const boundary = ring.map( ( point, i ) => edge( point, ring[ ( i + 1 ) % ring.length ] ) );
	expect( [ ...edges ].filter( ( [ , count ] ) => count === 1 ).map( ( [ key ] ) => key ).sort() ).toEqual( boundary.sort() );
	for ( const count of edges.values() ) expect( count === 1 || count === 2 ).toBe( true );
	for ( const [ key, count ] of edges ) if ( count === 2 ) expect( balances.get( key ) ).toBe( 0 );
	const ringArea = ring.reduce( ( sum, point, i ) => sum + cross( ring[ 0 ], point, ring[ ( i + 1 ) % ring.length ] ), 0 );
	expect( area ).toBe( Math.abs( ringArea ) );
}

const edge = ( a, b ) => [ a.join( ',' ), b.join( ',' ) ].sort().join( '|' );
const cross = ( a, b, c ) => ( b[ 0 ] - a[ 0 ] ) * ( c[ 1 ] - a[ 1 ] ) - ( b[ 1 ] - a[ 1 ] ) * ( c[ 0 ] - a[ 0 ] );
