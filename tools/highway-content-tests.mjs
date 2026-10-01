import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHighwayModel, highwayFrameAt, HIGHWAY_MATERIAL_SLOTS } from '../src/game/ground/HighwayModel.js';

const flat = () => ( {
	edgeIds: [ 'test-highway' ], path: [ [ 0, 0 ], [ 120, 0 ] ], width: 14, level: 8,
	deckThickness: 1, ramps: { start: 0, end: 0 },
	barriers: { left: { width: 0.3, height: 1.1 }, right: { width: 0.3, height: 1.1 } },
	elevationProfile: [ { distance: 0, level: 8 }, { distance: 120, level: 8 } ],
	supports: [ 20, 50, 80, 110 ].map( ( x ) => ( { position: [ x, 0 ],
		footprint: [ [ x - 1, - 1 ], [ x + 1, - 1 ], [ x + 1, 1 ], [ x - 1, 1 ] ], bottom: 0, top: 7 } ) )
} );
const near = ( a, b, epsilon = 0.001 ) => assert.ok( Math.abs( a - b ) < epsilon, a + ' != ' + b );
const position = ( attr, i ) => [ attr.getX( i ), attr.getY( i ), attr.getZ( i ) ];
const sub = ( a, b ) => a.map( ( v, i ) => v - b[ i ] );
const cross = ( a, b ) => [ a[ 1 ] * b[ 2 ] - a[ 2 ] * b[ 1 ], a[ 2 ] * b[ 0 ] - a[ 0 ] * b[ 2 ], a[ 0 ] * b[ 1 ] - a[ 1 ] * b[ 0 ] ];

function eachTriangle( model, visit ) {
	for ( const part of model.parts ) {
		const p = part.geometry.getAttribute( 'position' ), n = part.geometry.getAttribute( 'normal' ), uv = part.geometry.getAttribute( 'uv' );
		for ( let i = 0; i < p.count; i += 3 ) visit( part.slot, [ 0, 1, 2 ].map( ( j ) => position( p, i + j ) ),
			[ 0, 1, 2 ].map( ( j ) => position( n, i + j ) ), [ 0, 1, 2 ].map( ( j ) => [ uv.getX( i + j ), uv.getY( i + j ) ] ) );
	}
}

test( 'keeps authored width, depth and support/barrier envelopes without changing input', () => {
	const source = flat(), snapshot = JSON.stringify( source ), model = buildHighwayModel( source );
	assert.equal( JSON.stringify( source ), snapshot );
	near( model.bounds.min.x, 0 ); near( model.bounds.max.x, 120 );
	near( model.bounds.min.z, - 7.3 ); near( model.bounds.max.z, 7.3 );
	near( model.bounds.min.y, 0 ); near( model.bounds.max.y, 9.1 );
	for ( const part of model.parts ) {
		assert.ok( HIGHWAY_MATERIAL_SLOTS.includes( part.slot ) );
		const p = part.geometry.getAttribute( 'position' );
		for ( let i = 0; i < p.count; i ++ ) {
			const [ x, y, z ] = position( p, i );
			if ( part.slot === 'pier-concrete' ) {
				assert.ok( y >= - 0.001 && y <= 7.001 );
				assert.ok( source.supports.some( ( s ) => Math.abs( x - s.position[ 0 ] ) <= 1.001 && Math.abs( z ) <= 1.001 ) );
			} else if ( part.slot === 'barrier-concrete' ) {
				assert.ok( Math.abs( z ) >= 6.999 && Math.abs( z ) <= 7.301 && y >= 7.999 && y <= 9.101 );
			} else if ( part.slot === 'soffit-concrete' || part.slot === 'deck-concrete' ) {
				assert.ok( y >= 6.999 && y <= 8.001 && Math.abs( z ) <= 7.001 );
			}
		}
	}
	model.dispose();
} );

test( 'deck top and expansion seals cover the carriageway exactly once without holes', () => {
	const model = buildHighwayModel( flat() ), tops = [];
	let area = 0;
	eachTriangle( model, ( slot, p, n ) => {
		if ( ! [ 'roadway', 'joint-rubber' ].includes( slot ) || ! p.every( ( v ) => Math.abs( v[ 1 ] - 8 ) < 1e-6 ) || n[ 0 ][ 1 ] < 0.999 ) return;
		tops.push( p );
		area += Math.abs( cross( sub( p[ 1 ], p[ 0 ] ), sub( p[ 2 ], p[ 0 ] ) )[ 1 ] ) / 2;
	} );
	near( area, 120 * 14, 0.01 );
	for ( let x = 0.271; x < 120; x += 0.791 ) for ( let z = - 6.789; z < 7; z += 1.113 ) {
		const hits = tops.filter( ( p ) => pointInTriangle( [ x, z ], p.map( ( v ) => [ v[ 0 ], v[ 2 ] ] ) ) ).length;
		assert.equal( hits, 1, 'top coverage at ' + x + ',' + z + ': ' + hits );
	}
	model.dispose();
} );

test( 'all triangles have finite unit normals agreeing with winding and finite UVs', () => {
	const model = buildHighwayModel( flat() );
	eachTriangle( model, ( slot, p, n, uv ) => {
		assert.ok( p.flat().every( Number.isFinite ) );
		assert.ok( uv.flat().every( Number.isFinite ) );
		const normal = cross( sub( p[ 1 ], p[ 0 ] ), sub( p[ 2 ], p[ 0 ] ) ), length = Math.hypot( ...normal );
		assert.ok( length > 1e-9, 'degenerate ' + slot );
		for ( const value of n ) {
			near( Math.hypot( ...value ), 1, 1e-5 );
			assert.ok( value.reduce( ( sum, v, axis ) => sum + v * normal[ axis ] / length, 0 ) > 0.999 );
		}
	} );
	model.dispose();
} );

test( 'road retains U across / V along metres; underside and caps have noncollapsed area UVs', () => {
	const model = buildHighwayModel( flat() );
	let bottomFaces = 0, caps = 0;
	eachTriangle( model, ( slot, p, n, uv ) => {
		if ( slot === 'roadway' ) for ( let i = 0; i < 3; i ++ ) { near( uv[ i ][ 0 ], 7 - p[ i ][ 2 ] ); near( uv[ i ][ 1 ], p[ i ][ 0 ] ); }
		const determinant = ( uv[ 1 ][ 0 ] - uv[ 0 ][ 0 ] ) * ( uv[ 2 ][ 1 ] - uv[ 0 ][ 1 ] )
			- ( uv[ 1 ][ 1 ] - uv[ 0 ][ 1 ] ) * ( uv[ 2 ][ 0 ] - uv[ 0 ][ 0 ] );
		if ( slot === 'soffit-concrete' && n[ 0 ][ 1 ] < - 0.999 ) {
			bottomFaces ++;
			const world = Math.hypot( ...cross( sub( p[ 1 ], p[ 0 ] ), sub( p[ 2 ], p[ 0 ] ) ) );
			near( Math.abs( determinant ), world, 0.005 );
		}
		if ( slot === 'deck-concrete' && p.every( ( v ) => Math.abs( v[ 0 ] ) < 1e-6 || Math.abs( v[ 0 ] - 120 ) < 1e-6 ) ) {
			caps ++;
			assert.ok( Math.abs( determinant ) > 1e-8, 'end-cap UV collapsed' );
		}
	} );
	assert.ok( bottomFaces > 0 && caps > 0 );
	model.dispose();
} );

test( 'flat bearing seats stay inside support plan and original structural depth', () => {
	const source = flat(), model = buildHighwayModel( source );
	assert.equal( model.detail.bearings.length, 4 );
	assert.equal( model.detail.omittedBearings.length, 0 );
	for ( const bearing of model.detail.bearings ) {
		const support = source.supports[ bearing.support ];
		near( bearing.bottom, support.top );
		assert.ok( bearing.top <= 8 && bearing.top > bearing.bottom );
		assert.ok( bearing.footprint.every( ( p ) => Math.abs( p[ 0 ] - support.position[ 0 ] ) <= 1 && Math.abs( p[ 1 ] ) <= 1 ) );
	}
	const floor = 7.12, soffit = model.parts.find( ( p ) => p.slot === 'soffit-concrete' ).geometry.getAttribute( 'position' );
	assert.ok( Array.from( { length: soffit.count }, ( _, i ) => soffit.getY( i ) ).some( ( y ) => Math.abs( y - floor ) < 1e-4 ) );
	model.dispose();
} );

test( 'ramps retain profile breakpoints and omit unsupported bearing embellishment', () => {
	const source = flat();
	source.path = [ [ 0, 0 ], [ 100, 0 ] ];
	source.elevationProfile = [ { distance: 0, level: 0 }, { distance: 60, level: 8 }, { distance: 100, level: 8 } ];
	source.supports = [ { position: [ 30, 0 ], footprint: [ [ 29, - 1 ], [ 31, - 1 ], [ 31, 1 ], [ 29, 1 ] ], bottom: 0, top: 29 * 8 / 60 - 1 } ];
	const model = buildHighwayModel( source );
	assert.equal( model.detail.bearings.length, 0 );
	assert.equal( model.detail.omittedBearings[ 0 ].reason, 'sloped-soffit-no-extra-clearance' );
	near( model.bounds.min.y, - 1 );
	const road = model.parts.find( ( p ) => p.slot === 'roadway' ).geometry.getAttribute( 'position' );
	assert.ok( Array.from( { length: road.count }, ( _, i ) => position( road, i ) ).some( ( p ) => Math.abs( p[ 0 ] - 60 ) < 1e-6 && Math.abs( p[ 1 ] - 8 ) < 1e-6 ) );
	eachTriangle( model, ( slot, p ) => {
		if ( ! [ 'deck-concrete', 'soffit-concrete' ].includes( slot ) ) return;
		for ( const vertex of p ) {
			const top = Math.min( 8, vertex[ 0 ] * 8 / 60 );
			assert.ok( vertex[ 1 ] >= top - 1.001 && vertex[ 1 ] <= top + 0.001 );
		}
	} );
	model.dispose();
} );

test( 'corner cross-sections meet and closed routes have identical endpoint frames', () => {
	const source = flat();
	source.path = [ [ 0, 0 ], [ 60, 0 ], [ 60, 60 ] ];
	source.supports = [];
	const corner = highwayFrameAt( source, 60 );
	near( corner.offset[ 0 ], - 1 ); near( corner.offset[ 1 ], 1 );
	const model = buildHighwayModel( source );
	eachTriangle( model, ( slot, p, n ) => assert.ok( [ ...p.flat(), ...n.flat() ].every( Number.isFinite ) ) );
	model.dispose();
	source.path = [ [ 0, 0 ], [ 60, 0 ], [ 60, 60 ], [ 0, 60 ], [ 0, 0 ] ];
	source.elevationProfile[ 1 ].distance = 240;
	const first = highwayFrameAt( source, 0 ), last = highwayFrameAt( source, 240 );
	assert.deepEqual( first.offset, last.offset );
	assert.deepEqual( first.tangent, last.tangent );
	const loop = buildHighwayModel( source );
	assert.ok( loop.statistics.triangles > 0 );
	loop.dispose();
} );

test( 'equal input produces byte-identical streams and malformed source fails before publication', () => {
	const a = buildHighwayModel( flat() ), b = buildHighwayModel( flat() );
	assert.deepEqual( a.statistics, b.statistics );
	for ( let i = 0; i < a.parts.length; i ++ ) for ( const name of [ 'position', 'normal', 'uv' ] ) {
		assert.deepEqual( a.parts[ i ].geometry.getAttribute( name ).array, b.parts[ i ].geometry.getAttribute( name ).array );
	}
	const bad = flat(); bad.elevationProfile[ 1 ].distance = 119;
	assert.throws( () => buildHighwayModel( bad ), /E_HIGHWAY_CONTENT/ );
	bad.elevationProfile[ 1 ].distance = 120; bad.supports[ 0 ].position = [ NaN, 0 ];
	assert.throws( () => buildHighwayModel( bad ), /E_HIGHWAY_CONTENT/ );
	a.dispose(); b.dispose();
} );

function pointInTriangle( point, tri ) {
	const sign = ( a, b ) => ( point[ 0 ] - b[ 0 ] ) * ( a[ 1 ] - b[ 1 ] ) - ( a[ 0 ] - b[ 0 ] ) * ( point[ 1 ] - b[ 1 ] );
	const d = [ sign( tri[ 0 ], tri[ 1 ] ), sign( tri[ 1 ], tri[ 2 ] ), sign( tri[ 2 ], tri[ 0 ] ) ];
	return ! ( d.some( ( x ) => x < - 1e-7 ) && d.some( ( x ) => x > 1e-7 ) );
}

test( 'an edge-shifted support bearing contacts its cross-head without widening the pier', () => {
	const source = flat();
	for ( const support of source.supports ) {
		support.position[ 1 ] += 5.8;
		support.footprint = support.footprint.map( ( p ) => [ p[ 0 ], p[ 1 ] + 5.8 ] );
	}
	const model = buildHighwayModel( source ), seating = [];
	eachTriangle( model, ( slot, p, n ) => {
		if ( slot === 'soffit-concrete' && n[ 0 ][ 1 ] < - 0.999 && p.every( ( v ) => Math.abs( v[ 1 ] - 7.12 ) < 1e-4 ) ) seating.push( p.map( ( v ) => [ v[ 0 ], v[ 2 ] ] ) );
	} );
	for ( const bearing of model.detail.bearings ) for ( const corner of bearing.footprint ) {
		assert.ok( seating.some( ( tri ) => pointInTriangle( corner, tri ) ), 'bearing is below an empty cantilever bay' );
	}
	const pier = model.parts.find( ( p ) => p.slot === 'pier-concrete' ).geometry.getAttribute( 'position' );
	for ( let i = 0; i < pier.count; i ++ ) assert.ok( pier.getZ( i ) >= 4.799 && pier.getZ( i ) <= 6.801 );
	model.dispose();
} );

test( 'construction stations near a bend do not fold or overlap the inner roadway edge', () => {
	const source = flat();
	source.path = [ [ 0, 0 ], [ 60, 0 ], [ 60, 60 ] ];
	source.supports = [ { position: [ 57, 0 ], footprint: [ [ 56, - 1 ], [ 58, - 1 ], [ 58, 1 ], [ 56, 1 ] ], bottom: 0, top: 7 } ];
	const model = buildHighwayModel( source ), tops = [], seating = [];
	let area = 0;
	eachTriangle( model, ( slot, p, n ) => {
		if ( [ 'roadway', 'joint-rubber' ].includes( slot ) && n[ 0 ][ 1 ] > .999 && p.every( ( v ) => Math.abs( v[ 1 ] - 8 ) < 1e-5 ) ) {
			tops.push( p.map( ( v ) => [ v[ 0 ], v[ 2 ] ] ) );
			area += Math.abs( cross( sub( p[ 1 ], p[ 0 ] ), sub( p[ 2 ], p[ 0 ] ) )[ 1 ] ) / 2;
		}
		if ( slot === 'soffit-concrete' && n[ 0 ][ 1 ] < -.999 && p.every( ( v ) => Math.abs( v[ 1 ] - 7.12 ) < 1e-4 ) ) seating.push( p.map( ( v ) => [ v[ 0 ], v[ 2 ] ] ) );
	} );
	near( area, 120 * 14, .05 );
	for ( let x = 45.171; x < 70; x += .637 ) for ( let z = - 6.733; z < 20; z += .791 ) {
		const hits = tops.filter( ( p ) => pointInTriangle( [ x, z ], p ) ).length;
		const inside = ( x < 60 && z < 7 ) || ( x >= 53 && x <= 67 && z >= 0 );
		assert.ok( hits <= 1, 'overlapping corner top' );
		if ( inside ) assert.equal( hits, 1, 'missing corner top' );
	}
	for ( const bearing of model.detail.bearings ) for ( const corner of bearing.footprint ) assert.ok( seating.some( ( tri ) => pointInTriangle( corner, tri ) ), 'bent-route bearing loses contact' );
	model.dispose();
} );
