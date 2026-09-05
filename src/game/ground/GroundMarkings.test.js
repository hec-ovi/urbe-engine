import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { GroundMarkings } from './GroundMarkings.js';

const bindings = { version: 1, surfaces: {
	white: { kind: 'street-marking-white', variant: 'paint' }, accent: { kind: 'street-marking-accent', variant: 'paint' }
} };
const factory = { build( key, variantId ) {
	const material = new THREE.MeshStandardMaterial();
	material.userData = { key, variantId };
	return material;
} };

function fixture( { length = 100, angle = 0, reverse = false, laneCount = 4 } = {} ) {
	const width = laneCount * 3.5;
	const offsets = laneCount === 1 ? [ 0 ] : laneCount === 2 ? [ 1.75, - 1.75 ] : [ 5.25, 1.75, - 1.75, - 5.25 ];
	const point = ( x, z ) => [ 30 + x * Math.cos( angle ) - z * Math.sin( angle ), - 20 + x * Math.sin( angle ) + z * Math.cos( angle ) ];
	const coordinates = position => [ ( position[ 0 ] - 30 ) * Math.cos( angle ) + ( position[ 2 ] + 20 ) * Math.sin( angle ),
		- ( position[ 0 ] - 30 ) * Math.sin( angle ) + ( position[ 2 ] + 20 ) * Math.cos( angle ) ];
	const rect = ( a, b, z0 = - width / 2, z1 = width / 2 ) => [ point( a, z0 ), point( b, z0 ), point( b, z1 ), point( a, z1 ) ];
	const edge = { id: 'e', from: reverse ? 'b' : 'a', to: reverse ? 'a' : 'b', width,
		path: reverse ? [ point( length, 0 ), point( 0, 0 ) ] : [ point( 0, 0 ), point( length, 0 ) ],
		elevationProfile: [ { distance: 0, level: 0 }, { distance: length, level: 0 } ] };
	const near = Math.min( 10, length * 0.2 );
	const limits = [ [ near, near + 3 ], [ length - near - 3, length - near ] ];
	const approaches = limits.map( ( [ from, to ], i ) => ( {
		nodeId: i ? 'b' : 'a', edgeId: 'e', groupId: `j${i}`, distance: reverse ? length - ( from + to ) / 2 : ( from + to ) / 2,
		station: reverse ? [ length - to, length - from ] : [ from, to ], field: rect( from, to ), landings: { left: [], right: [] },
		cut: { left: point( i ? to : from, ( reverse ? - 1 : 1 ) * width / 2 ), right: point( i ? to : from, ( reverse ? 1 : - 1 ) * width / 2 ) }
	} ) );
	const crossings = limits.map( ( [ from, to ], i ) => ( {
		nodeId: i ? 'b' : 'a', junctionId: `j${i}`, segments: [ { edgeId: 'e', width: 3,
			from: point( ( from + to ) / 2, - width / 2 - 1 ), to: point( ( from + to ) / 2, width / 2 + 1 ),
			markings: Array.from( { length: Math.floor( width ) }, ( _, j ) => rect( from, to, - width / 2 + 0.25 + j, - width / 2 + 0.75 + j ) ) } ]
	} ) );
	const lanes = offsets.map( ( z, i ) => {
		const forward = z < 0;
		const path = forward ? [ point( 0, z ), point( length, z ) ] : [ point( length, z ), point( 0, z ) ];
		return { id: `lane${i}`, edgeId: 'e', index: i % 2, width: 3.5, path3: path.map( ( [ x, z ] ) => [ x, 0, z ] ),
			sourceDirection: forward !== reverse ? 'forward' : 'backward', sourceOffset: reverse ? - z : z,
			next: [ { laneId: `lane${i}`, turn: i === 0 ? 'l' : i === 3 ? 'r' : 's' }, ...( i === 1 ? [ { laneId: 'lane1', turn: 'l' } ] : [] ) ] };
	} );
	return { atlas: { streets: { edges: [ edge ], crossings, construction: {
		junctions: approaches.map( ( approach, i ) => ( { id: `j${i}`, groupIds: [ `j${i}` ], nodeIds: [ approach.nodeId ], internalEdgeIds: [], approaches: [ approach ] } ) )
	} } }, road: { lanes }, coordinates };
}

function build( data, settings ) { return new GroundMarkings( data.atlas, data.road, factory, bindings, settings ).build(); }

describe( 'GroundMarkings', () => {
	it( 'derives one-way and two-way paint from the supplied lane count without extra dividers', () => {
		for ( const laneCount of [ 1, 2 ] ) {
			const data = fixture( { laneCount } );
			const result = build( data );
			expect( result.primitives.filter( primitive => primitive.kind === 'edge' ) ).toHaveLength( 2 );
			expect( result.primitives.filter( primitive => primitive.kind === 'center' ) ).toHaveLength( laneCount === 1 ? 0 : 2 );
			expect( result.primitives.filter( primitive => primitive.kind === 'divider' ) ).toEqual( [] );
			expect( result.primitives.filter( primitive => primitive.kind === 'stop' ) ).toHaveLength( laneCount );
			for ( const primitive of result.primitives.filter( primitive => primitive.kind !== 'crossing' ) ) {
				for ( const point of primitive.polygons.flat() ) expect( Math.abs( data.coordinates( point )[ 1 ] ) ).toBeLessThan( laneCount * 3.5 / 2 );
			}
		}
	} );
	it( 'keeps four-lane paint disjoint and outside the exact complete crossing fields', () => {
		const data = fixture();
		const result = build( data );
		expect( result.group.children ).toHaveLength( 2 );
		expect( result.primitives.filter( p => p.kind === 'center' ) ).toHaveLength( 2 );
		expect( result.primitives.filter( p => p.kind === 'edge' ) ).toHaveLength( 2 );
		expect( result.primitives.filter( p => p.kind === 'stop' ) ).toHaveLength( 4 );
		expect( result.primitives.filter( p => p.kind === 'arrow' ) ).toHaveLength( 4 );
		for ( const primitive of result.primitives.filter( p => p.kind !== 'crossing' ) ) {
			for ( const polygon of primitive.polygons ) for ( const point of polygon ) {
				const [ x, z ] = data.coordinates( point );
				expect( x ).toBeGreaterThanOrEqual( 13.3 - 1e-8 );
				expect( x ).toBeLessThanOrEqual( 86.7 + 1e-8 );
				expect( Math.abs( z ) ).toBeLessThan( 7 );
			}
		}
		const polygons = result.primitives.flatMap( primitive => primitive.polygons.map( polygon => polygon.map( data.coordinates ) ) );
		for ( let i = 0; i < polygons.length; i ++ ) for ( let j = i + 1; j < polygons.length; j ++ ) expect( overlap( polygons[ i ], polygons[ j ] ), `marking polygons ${i}/${j}` ).toBeLessThan( 1e-8 );
		const stripes = result.primitives.filter( primitive => primitive.kind === 'crossing' ).flatMap( primitive => primitive.polygons.map( polygon => polygon.map( ( [ x, , z ] ) => [ x, z ] ) ) );
		expect( stripes ).toEqual( data.atlas.streets.crossings.flatMap( crossing => crossing.segments[ 0 ].markings ) );
		expect( result.group.children.map( mesh => mesh.material.userData.key ) ).toEqual( [ 'cyberpunk/street-marking-white/mid', 'cyberpunk/street-marking-accent/mid' ] );
	} );

	it( 'preserves arrow travel direction and actual allowed branches when the source edge reverses and rotates', () => {
		const data = fixture( { angle: 0.317, reverse: true } );
		const result = build( data );
		for ( const arrow of result.primitives.filter( primitive => primitive.kind === 'arrow' ) ) {
			const lane = data.road.lanes.find( lane => lane.id === arrow.laneId );
			expect( arrow.turns ).toEqual( [ ...new Set( lane.next.map( next => next.turn ) ) ].sort() );
			const xs = arrow.polygons.flatMap( polygon => polygon.map( point => data.coordinates( point )[ 0 ] ) );
			expect( Math.min( ...xs ) ).toBeGreaterThan( lane.id === 'lane0' || lane.id === 'lane1' ? 14 : 75 );
			expect( Math.max( ...xs ) ).toBeLessThan( lane.id === 'lane0' || lane.id === 'lane1' ? 25 : 86 );
			if ( arrow.turns.length === 1 && arrow.turns[ 0 ] !== 's' ) {
				const a = lane.path3[ 0 ], b = lane.path3.at( - 1 );
				const span = Math.hypot( b[ 0 ] - a[ 0 ], b[ 2 ] - a[ 2 ] );
				const across = arrow.polygons.flatMap( polygon => polygon.map( point => ( - ( b[ 2 ] - a[ 2 ] ) * ( point[ 0 ] - a[ 0 ] ) + ( b[ 0 ] - a[ 0 ] ) * ( point[ 2 ] - a[ 2 ] ) ) / span ) );
				const extent = arrow.turns[ 0 ] === 'l' ? Math.max( ...across ) : - Math.min( ...across );
				expect( extent ).toBeCloseTo( 0.75, 7 );
				const opposite = arrow.turns[ 0 ] === 'l' ? - Math.min( ...across ) : Math.max( ...across );
				expect( opposite ).toBeCloseTo( 0.135, 7 );
			}
		}
		for ( const mesh of result.group.children ) {
			const normal = mesh.geometry.getAttribute( 'normal' );
			for ( let i = 0; i < normal.count; i ++ ) expect( normal.getY( i ) ).toBeGreaterThan( 0.99 );
		}
	} );

	it( 'keeps complete dash and arrow units on a short approach', () => {
		const data = fixture( { length: 20 } );
		const result = build( data );
		expect( result.primitives.filter( p => p.kind === 'arrow' ) ).toEqual( [] );
		expect( result.omitted ).toHaveLength( 4 );
		for ( const primitive of result.primitives.filter( p => p.kind === 'divider' ) ) {
			const xs = primitive.polygons.flatMap( polygon => polygon.map( point => data.coordinates( point )[ 0 ] ) );
			expect( Math.max( ...xs ) - Math.min( ...xs ) ).toBeCloseTo( 3, 7 );
		}
	} );

	it( 'retains legacy 3D lane intervals without inventing approach marks', () => {
		const data = fixture();
		delete data.atlas.streets.construction;
		data.atlas.streets.crossings = [];
		data.road.lanes = data.road.lanes.slice( 0, 1 );
		const lane = data.road.lanes[ 0 ];
		delete lane.sourceDirection;
		delete lane.sourceOffset;
		lane.path3 = [ [ 0, 0, 0 ], [ 10, 4, 0 ], [ 30, 4, 0 ] ];
		const result = build( data );
		expect( new Set( result.primitives.map( p => p.kind ) ) ).toEqual( new Set( [ 'edge' ] ) );
		expect( Math.max( ...result.primitives.flatMap( p => p.polygons.flatMap( polygon => polygon.map( point => point[ 1 ] ) ) ) ) ).toBe( 4 );
		expect( result.group.children[ 0 ].geometry.getAttribute( 'position' ).getY( 0 ) ).toBeCloseTo( 0.003, 6 );
	} );

	it( 'keeps bent one-way edge strips disjoint through the shared miter', () => {
		const data = fixture( { laneCount: 1 } );
		data.atlas.streets.crossings = [];
		data.atlas.streets.construction.junctions = [];
		data.atlas.streets.edges[ 0 ].path = [ [ 0, 0 ], [ 20, 0 ], [ 20, 20 ] ];
		data.road.lanes[ 0 ].path3 = [ [ 0, 0, 0 ], [ 20, 0, 0 ], [ 20, 0, 20 ] ];
		data.road.lanes[ 0 ].sourceDirection = 'forward';
		const result = build( data );
		const polygons = result.primitives.flatMap( primitive => primitive.polygons.map( polygon => polygon.map( ( [ x, , z ] ) => [ x, z ] ) ) );
		expect( polygons ).toHaveLength( 4 );
		for ( let i = 0; i < polygons.length; i ++ ) for ( let j = i + 1; j < polygons.length; j ++ ) expect( overlap( polygons[ i ], polygons[ j ] ) ).toBeLessThan( 1e-8 );
	} );

	it( 'rejects missing authority, unsupported settings and absent material bindings', () => {
		for ( const mutate of [ data => { data.road.lanes[ 0 ].sourceOffset = NaN; },
			data => { data.atlas.streets.construction.junctions[ 0 ].approaches[ 0 ].cut = null; },
			data => { data.road.lanes[ 0 ].next[ 0 ].turn = 'invented'; },
			data => { data.atlas.streets.crossings[ 0 ].segments[ 0 ].markings[ 0 ][ 0 ][ 0 ] = NaN; } ] ) {
			const data = fixture();
			mutate( data );
			expect( () => build( data ) ).toThrow( expect.objectContaining( { code: 'E_GROUND_MARKINGS' } ) );
		}
		expect( () => build( fixture(), { lineWidth: 0 } ) ).toThrow( expect.objectContaining( { code: 'E_GROUND_MARKINGS' } ) );
		expect( () => new GroundMarkings( fixture().atlas, fixture().road, factory, null ).build() ).toThrow( expect.objectContaining( { code: 'E_GROUND_MARKINGS' } ) );
		expect( () => new GroundMarkings( fixture().atlas, fixture().road, null, bindings ).build() ).toThrow( expect.objectContaining( { code: 'E_GROUND_MARKINGS' } ) );
	} );
} );

const cross = ( a, b, c ) => ( b[ 0 ] - a[ 0 ] ) * ( c[ 1 ] - a[ 1 ] ) - ( b[ 1 ] - a[ 1 ] ) * ( c[ 0 ] - a[ 0 ] );
const area = polygon => Math.abs( polygon.reduce( ( total, p, i ) => { const q = polygon[ ( i + 1 ) % polygon.length ]; return total + p[ 0 ] * q[ 1 ] - p[ 1 ] * q[ 0 ]; }, 0 ) ) / 2;
function overlap( polygon, clip ) {
	const orientation = Math.sign( clip.reduce( ( sum, point, i ) => { const next = clip[ ( i + 1 ) % clip.length ]; return sum + point[ 0 ] * next[ 1 ] - point[ 1 ] * next[ 0 ]; }, 0 ) );
	for ( let i = 0; i < clip.length && polygon.length; i ++ ) {
		const output = [], a = clip[ i ], b = clip[ ( i + 1 ) % clip.length ];
		for ( let j = 0; j < polygon.length; j ++ ) {
			const p = polygon[ j ], q = polygon[ ( j + 1 ) % polygon.length ];
			const dp = cross( a, b, p ) * orientation, dq = cross( a, b, q ) * orientation;
			if ( dp >= 0 ) output.push( p );
			if ( ( dp >= 0 ) !== ( dq >= 0 ) ) { const t = dp / ( dp - dq ); output.push( [ p[ 0 ] + ( q[ 0 ] - p[ 0 ] ) * t, p[ 1 ] + ( q[ 1 ] - p[ 1 ] ) * t ] ); }
		}
		polygon = output;
	}
	return polygon.length >= 3 ? area( polygon ) : 0;
}
