import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { GroundBuilder } from './GroundBuilder.js';
import { groundPageGeometry } from './GroundPageGeometry.js';
import { highwayGlows } from './HighwayFixtures.js';

const factory = { build: ( key, variantId ) => {

	const material = new THREE.MeshStandardMaterial();
	material.userData = { key, variantId };
	return material;

} };

/** A factory that tunes copies and knows which keys its theme has. */
function tuning( keys = null ) {

	const made = [];
	return {
		made,
		resolver: { resolve: ( key ) => ( ! keys || keys.includes( key ) ? {} : null ) },
		build: factory.build,
		dataMap: ( key, variant, name ) => ( { texture: Object.assign( new THREE.Texture(), { name: `${key}#${variant}:${name}` } ), ready: Promise.resolve() } ),
		variant( key, tweaks ) {

			const material = new THREE.MeshStandardMaterial();
			material.userData = { key, ...tweaks };
			made.push( material );
			return material;

		}
	};

}

/** Every concrete part of the built highway, merged. */
function concrete( built ) {

	const parts = built.group.getObjectByName( 'highways' ).children.filter( ( mesh ) => mesh.name !== 'highway:roadway' ).map( ( mesh ) => {

		const copy = new THREE.BufferGeometry();
		copy.setAttribute( 'position', mesh.geometry.getAttribute( 'position' ) );
		return copy;

	} );
	const merged = new THREE.BufferGeometry();
	merged.setAttribute( 'position', new THREE.Float32BufferAttribute( parts.flatMap( ( part ) => [ ...part.getAttribute( 'position' ).array ] ), 3 ) );
	return merged;

}

describe( 'highway structures', () => {

	it( 'builds the exact ramp, deck width, structural depth and support footprint', () => {

		const built = new GroundBuilder( atlas(), factory ).build();
		const road = built.group.getObjectByName( 'highway:roadway' ).geometry;
		const frame = concrete( built );

		expect( levelsAt( road, 0 ) ).toEqual( [ 0 ] );
		// The source path has only x=0 and x=100. The 60 m ramp endpoint must
		// become its own cross-section or one triangle would flatten the break.
		expect( levelsAt( road, 60 ) ).toEqual( [ 8 ] );
		expect( levelsAt( road, 30 ) ).toEqual( [] );
		expect( levelsAt( road, 100 ) ).toEqual( [ 8 ] );
		expect( range( road, 'z' ) ).toEqual( [ - 5, 5 ] );
		// The parapets stand 1.1 m over the deck.
		expect( range( frame, 'y' ) ).toEqual( [ - 1, 9.1 ] );

		for ( const x of [ 79, 81 ] ) expect( values( frame, 'x' ) ).toContain( x );
		expect( built.colliderGeometry ).not.toBe( null );
		expect( range( built.colliderGeometry, 'y' ) ).toEqual( [ - 1, 9.1 ] );

	} );

	it( 'uses the lane-aligned highway material with U across and V along the deck', () => {

		const mesh = new GroundBuilder( atlas(), factory ).build().group.getObjectByName( 'highway:roadway' );

		expect( mesh.material.userData ).toEqual( {
			key: 'cyberpunk/road/high_rich', variantId: 'highway'
		} );
		expect( uvAt( mesh.geometry, 0, 5 ) ).toEqual( [ [ 0, 0 ] ] );
		expect( uvAt( mesh.geometry, 0, - 5 ) ).toEqual( [ [ 10, 0 ] ] );
		expect( uvAt( mesh.geometry, 100, 5 ) ).toEqual( [ [ 0, 100 ] ] );
		expect( uvAt( mesh.geometry, 100, - 5 ) ).toEqual( [ [ 10, 100 ] ] );

	} );

	it( 'draws each authored part with its Materials finish and the structure\'s own wear', () => {

		const made = tuning();
		const built = new GroundBuilder( atlas(), made ).build();
		const names = built.group.getObjectByName( 'highways' ).children.map( ( mesh ) => mesh.name ).sort();
		expect( names ).toEqual( [ 'highway:barrier-concrete', 'highway:bearing-steel', 'highway:deck-concrete', 'highway:fixtures', 'highway:joint-rubber',
			'highway:lamp-lenses', 'highway:pier-concrete', 'highway:puddles', 'highway:roadway', 'highway:soffit-concrete' ] );
		const material = ( name ) => built.group.getObjectByName( `highway:${name}` ).material.userData;
		expect( material( 'pier-concrete' ) ).toMatchObject( { key: 'cyberpunk/highway-concrete/mid', variantId: 'pier', weather: 'highway-pier' } );
		expect( material( 'soffit-concrete' ) ).toMatchObject( { variantId: 'soffit', weather: 'highway-soffit' } );
		expect( material( 'deck-concrete' ) ).toMatchObject( { variantId: 'formed', weather: 'highway-deck' } );
		expect( material( 'barrier-concrete' ) ).toMatchObject( { variantId: 'formed', weather: 'highway-barrier' } );
		expect( material( 'bearing-steel' ) ).toMatchObject( { key: 'cyberpunk/service-alloy/poor', variantId: 'brushed' } );
		expect( material( 'bearing-steel' ).weather ).toBeUndefined();
		// The deck and the parapets share the formed maps; a sprayed pier names its paint, so none shares a program.
		expect( built.group.getObjectByName( 'highway:pier-concrete' ).material.wearProfile ).toMatch( /\+graffiti$/ );
		expect( material( 'roadway' ) ).toEqual( { key: 'cyberpunk/road/high_rich', variantId: 'highway' } );
		expect( built.group.getObjectByName( 'highway:pier-concrete' ).material.normalScale.x ).toBeCloseTo( 0.6 );
		// The piers are sprayed with the theme's graffiti, which the renderer prepares with them.
		const pier = built.group.getObjectByName( 'highway:pier-concrete' );
		expect( pier.material.userData.highwayGraffiti ).toBe( 'cyberpunk/graffiti-atlas/poor' );
		expect( pier.material[ Symbol.for( 'urbe.material-resources' ) ].map( ( resource ) => resource.texture.name ) ).toContain( 'cyberpunk/graffiti-atlas/poor#markers:basecolor' );
		const centre = pier.geometry.getAttribute( '_highway_pier' );
		for ( let i = 0; i < centre.count; i ++ ) expect( [ centre.getX( i ), centre.getY( i ) ] ).toEqual( [ 80, 0 ] );
		expect( built.group.getObjectByName( 'highway:deck-concrete' ).material.userData.highwayGraffiti ).toBeUndefined();

		// A theme without the highway finishes keeps its plain concrete.
		const plain = new GroundBuilder( atlas(), tuning( [ 'cyberpunk/road/high_rich' ] ) ).build();
		expect( plain.group.getObjectByName( 'highway:pier-concrete' ).material.userData ).toEqual( { key: 'cyberpunk/concrete/rich', variantId: undefined } );

	} );

	it( 'hands each worn part the base of the pier it belongs to and the joints either side, and nothing to the parts no wear reads', () => {

		const built = new GroundBuilder( atlas(), tuning() ).build();
		const pier = built.group.getObjectByName( 'highway:pier-concrete' ).geometry;
		const context = pier.getAttribute( '_highway_context' );
		expect( context.itemSize ).toBe( 4 );
		for ( let i = 0; i < context.count; i ++ ) expect( [ context.getX( i ), context.getY( i ) ] ).toEqual( [ 0, 7 ] );
		const soffit = built.group.getObjectByName( 'highway:soffit-concrete' ).geometry;
		const source = soffit.getAttribute( '_highway_source' ), around = soffit.getAttribute( '_highway_context' );
		// The one joint stands over the pier at x = 80: every soffit point knows how far it is.
		for ( let i = 0; i < source.count; i ++ ) {

			const station = source.getX( i );
			expect( Math.min( Math.abs( station - around.getZ( i ) ), Math.abs( around.getW( i ) - station ) ), `${i}` ).toBeCloseTo( Math.abs( station - 80 ), 3 );

		}
		expect( soffit.getAttribute( '_highway_face' ).array ).toBeInstanceOf( Float32Array );
		for ( const name of [ 'roadway', 'bearing-steel', 'joint-rubber' ] ) {

			const geometry = built.group.getObjectByName( `highway:${name}` ).geometry;
			expect( Object.keys( geometry.attributes ).sort() ).toEqual( [ 'normal', 'position', 'uv' ] );

		}

	} );

	it( 'hangs a sodium lamp, its conduit and a drain pipe on every pier with headroom, a puddle at the pipe\'s foot and a cable to the next pier, and counts the lamps as lights', () => {

		const input = atlas();
		const pier = ( x, top ) => ( { position: [ x, 0 ], footprint: [ [ x - 1, - 1 ], [ x + 1, - 1 ], [ x + 1, 1 ], [ x - 1, 1 ] ], bottom: 0, top } );
		input.streets.highwayStructures[ 0 ].supports = [ pier( 20, 2.4 ), pier( 70, 7 ), pier( 90, 7 ) ];
		const built = new GroundBuilder( input, tuning() ).build();
		const named = ( name ) => built.group.getObjectByName( `highway:${name}` );
		for ( const name of [ 'fixtures', 'cables', 'lamp-lenses', 'puddles' ] ) expect( named( name ), name ).toBeDefined();
		// Water, cables and lenses never stand in the way.
		for ( const name of [ 'cables', 'lamp-lenses', 'puddles' ] ) expect( named( name ).userData.groundModule.role ).toBe( 'marking' );
		const glows = highwayGlows( input );
		expect( glows.length ).toBe( 2 );
		for ( const glow of glows ) {

			expect( glow.position.y ).toBeCloseTo( 7 - 1.15 );
			expect( Math.abs( glow.position.z ) ).toBeGreaterThan( 1 );

		}
		// Lamps alternate sides of the carriageway, pier to pier.
		expect( Math.sign( glows[ 0 ].position.z ) ).not.toBe( Math.sign( glows[ 1 ].position.z ) );
		const puddle = named( 'puddles' ).geometry.getAttribute( 'position' );
		for ( let i = 0; i < puddle.count; i ++ ) expect( puddle.getY( i ) ).toBeCloseTo( 0.012 );

	} );

	it( 'keeps the structure coordinates its wear reads when the streamed ground merges it into a page', async () => {

		const built = new GroundBuilder( atlas(), tuning() ).build();
		const page = await groundPageGeometry( new Map( [ [ 'tile', { group: built.group } ] ] ), () => true );
		const pier = page.children.find( ( mesh ) => mesh.material === built.group.getObjectByName( 'highway:pier-concrete' ).material );
		for ( const name of [ '_highway_source', '_highway_face', '_highway_context', '_highway_pier' ] ) expect( pier.geometry.getAttribute( name ), name ).toBeDefined();
		const context = pier.geometry.getAttribute( '_highway_context' );
		expect( [ context.getX( 0 ), context.getY( 0 ) ] ).toEqual( [ 0, 7 ] );
		expect( pier.geometry.getAttribute( '_highway_pier' ).getX( 0 ) ).toBe( 80 );

	} );

	it( 'fails closed when the elevation profile does not cover the path', () => {

		const input = atlas();
		input.streets.highwayStructures[ 0 ].elevationProfile.at( - 1 ).distance = 99;

		expect( () => new GroundBuilder( input, factory ).build() ).toThrow( /E_HIGHWAY_STRUCTURE: highwayStructures\[0\]\.elevationProfile/ );

	} );


} );

function atlas() {

	return { volumetric: { ground: [] }, streets: { highwayStructures: [ {
		edgeIds: [ 'e0' ], path: [ [ 0, 0 ], [ 100, 0 ] ], width: 10, level: 8,
		deckThickness: 1, ramps: { start: 60, end: 0 }, barriers: { left: { width: 0.3, height: 1.1 }, right: { width: 0.3, height: 1.1 } },
		elevationProfile: [
			{ distance: 0, level: 0 }, { distance: 60, level: 8 }, { distance: 100, level: 8 }
		],
		supports: [ {
			position: [ 80, 0 ], footprint: [ [ 79, - 1 ], [ 81, - 1 ], [ 81, 1 ], [ 79, 1 ] ],
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
