import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { Highways } from './Highways.js';

const factory = { build: ( key, variantId ) => {

	const material = new THREE.MeshStandardMaterial();
	material.userData = { key, variantId };
	return material;

} };

describe( 'highway structures', () => {

	it( 'builds the exact ramp, deck width, structural depth and support footprint', () => {

		const built = new Highways( atlas(), factory ).build();
		const road = built.group.getObjectByName( 'highway:roadway' ).geometry;
		const frame = built.group.getObjectByName( 'highway:structure' ).geometry;

		expect( levelsAt( road, 0 ) ).toEqual( [ 0 ] );
		expect( levelsAt( road, 60 ) ).toEqual( [ 8 ] );
		expect( levelsAt( road, 100 ) ).toEqual( [ 8 ] );
		expect( range( road, 'z' ) ).toEqual( [ - 5, 5 ] );
		expect( range( frame, 'y' ) ).toEqual( [ - 1, 8 ] );

		for ( const x of [ 49, 51 ] ) expect( values( frame, 'x' ) ).toContain( x );
		expect( built.colliderGeometry ).not.toBe( null );
		expect( range( built.colliderGeometry, 'y' ) ).toEqual( [ - 1, 8 ] );

	} );

	it( 'adds an elevation breakpoint inside a centerline segment', () => {

		const road = new Highways( atlas(), factory ).build().group.getObjectByName( 'highway:roadway' ).geometry;

		// The source path has only x=0 and x=100. The 60 m ramp endpoint must
		// become its own cross-section or one triangle would flatten the break.
		expect( values( road, 'x' ) ).toContain( 60 );
		expect( levelsAt( road, 30 ) ).toEqual( [] );

	} );

	it( 'uses the lane-aligned highway material with U across and V along the deck', () => {

		const mesh = new Highways( atlas(), factory ).build().group.getObjectByName( 'highway:roadway' );

		expect( mesh.material.userData ).toEqual( {
			key: 'cyberpunk/road/high_rich', variantId: 'highway'
		} );
		expect( uvAt( mesh.geometry, 0, 5 ) ).toEqual( [ [ 0, 0 ] ] );
		expect( uvAt( mesh.geometry, 0, - 5 ) ).toEqual( [ [ 10, 0 ] ] );
		expect( uvAt( mesh.geometry, 100, 5 ) ).toEqual( [ [ 0, 100 ] ] );
		expect( uvAt( mesh.geometry, 100, - 5 ) ).toEqual( [ [ 10, 100 ] ] );

	} );

	it( 'fails closed when the elevation profile does not cover the path', () => {

		const input = atlas();
		input.streets.highwayStructures[ 0 ].elevationProfile.at( - 1 ).distance = 99;

		expect( () => new Highways( input, factory ).build() ).toThrow( /E_HIGHWAY_STRUCTURE: highwayStructures\[0\]\.elevationProfile/ );

	} );

	it( 'builds an empty group when Atlas publishes no highways', () => {

		const built = new Highways( { streets: { highwayStructures: [] } }, factory ).build();

		expect( built.group.children ).toHaveLength( 0 );
		expect( built.colliderGeometry ).toBe( null );
		expect( built.triangles ).toBe( 0 );

	} );

} );

function atlas() {

	return { streets: { highwayStructures: [ {
		edgeIds: [ 'e0' ], path: [ [ 0, 0 ], [ 100, 0 ] ], width: 10, level: 8,
		deckThickness: 1, ramps: { start: 60, end: 0 },
		elevationProfile: [
			{ distance: 0, level: 0 }, { distance: 60, level: 8 }, { distance: 100, level: 8 }
		],
		supports: [ {
			position: [ 50, 0 ], footprint: [ [ 49, - 1 ], [ 51, - 1 ], [ 51, 1 ], [ 49, 1 ] ],
			bottom: 0, top: 7
		} ]
	} ] } };

}

function levelsAt( geometry, x ) {

	const position = geometry.getAttribute( 'position' );
	const found = new Set();

	for ( let i = 0; i < position.count; i ++ ) {

		if ( close( position.getX( i ), x ) ) found.add( round( position.getY( i ) ) );

	}

	return [ ...found ].sort( ( a, b ) => a - b );

}

function values( geometry, axis ) {

	const position = geometry.getAttribute( 'position' );
	const read = axis === 'x' ? ( i ) => position.getX( i ) : axis === 'y' ? ( i ) => position.getY( i ) : ( i ) => position.getZ( i );
	const found = new Set();

	for ( let i = 0; i < position.count; i ++ ) found.add( round( read( i ) ) );

	return [ ...found ];

}

function range( geometry, axis ) {

	const all = values( geometry, axis );

	return [ Math.min( ...all ), Math.max( ...all ) ];

}

function uvAt( geometry, x, z ) {

	const position = geometry.getAttribute( 'position' );
	const uv = geometry.getAttribute( 'uv' );
	const found = new Map();

	for ( let i = 0; i < position.count; i ++ ) {

		if ( ! close( position.getX( i ), x ) || ! close( position.getZ( i ), z ) ) continue;
		const pair = [ round( uv.getX( i ) ), round( uv.getY( i ) ) ];
		found.set( pair.join( ',' ), pair );

	}

	return [ ...found.values() ];

}

const close = ( a, b ) => Math.abs( a - b ) < 1e-4;
const round = ( value ) => Math.round( value * 1e4 ) / 1e4;
