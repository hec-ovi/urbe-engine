import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PbrMaterialFactory } from '../../building/PbrMaterialFactory.js';
import { fakeResolver } from '../../building/material-resolver.test-fixtures.js';
import { Links, ROOFTOP_WIRE_SIDES } from './Links.js';

const CONNECTIONS_FIXTURE = new URL( './links.fixture.json', import.meta.url );
const ROOFTOP_FIXTURE = new URL( '../../../../connections/fixtures/rooftop-spans.request.json', import.meta.url );

/** No theme is served under node, so every key falls back. Keys still differ. */
const factory = new PbrMaterialFactory( fakeResolver( () => null, () => '' ) );

describe( 'Links', () => {

	const doc = JSON.parse( readFileSync( CONNECTIONS_FIXTURE, 'utf8' ) );

	/**
	 * The one thing a link cannot get wrong. The facade is carved with the
	 * aperture's cut polygon; a sweep cut square to its own axis instead of to
	 * the wall misses that hole by centimetres on every diagonal link, which is
	 * a gap you can see daylight through or a tube poking out of a wall.
	 *
	 * Every rect link is a closed section, so it meets all four corners of its
	 * cut: the floor lands on the plate the exterior box aligned to that
	 * aperture and the roof closes on the head of the opening.
	 */
	it( 'lands every end face on the aperture the facade was cut with', () => {

		const built = new Links( doc, factory ).build();
		const points = [];

		for ( const mesh of built.group.children ) {

			const position = mesh.geometry.getAttribute( 'position' );

			for ( let i = 0; i < position.count; i ++ ) points.push( [ position.getX( i ), position.getY( i ), position.getZ( i ) ] );

		}

		const cuts = new Map( doc.apertures.map( ( aperture ) => [ aperture.id, aperture.cut.polygon ] ) );
		let worst = 0;
		let ends = 0;

		for ( const link of doc.links ) {

			if ( link.crossSection.shape !== 'rect' ) continue;

			for ( const end of [ link.a, link.b ] ) {

				ends ++;

				for ( const vertex of cuts.get( end.apertureId ) ) worst = Math.max( worst, nearest( points, vertex ) );

			}

		}

		expect( ends ).toBeGreaterThan( 0 );
		expect( worst ).toBeLessThan( 1e-3 );

	} );

	/**
	 * What is solid follows the published flags, not the kind. A wire is
	 * something to look at; an AC tube is walked over, and the surface that
	 * carries you has to be the tube's own roof rather than anywhere near it.
	 */
	it( 'makes solid only what the walkable flags claim', () => {

		const wire = doc.links.find( ( link ) => link.kind === 'wire' );

		expect( wire.walkable.inside ).toBe( false );
		expect( new Links( { links: [ wire ], apertures: doc.apertures }, factory ).build().colliderGeometry ).toBe( null );

		const tube = doc.links.find( ( link ) => link.kind === 'ac-tube' && level( link ) );
		const base = doc.apertures.find( ( aperture ) => aperture.id === tube.a.apertureId ).base;
		const roof = base + tube.crossSection.height;

		expect( tube.walkable.over ).toBe( true );

		const collider = new Links( { links: [ tube ], apertures: doc.apertures }, factory ).build().colliderGeometry;
		const up = upwardFacing( collider );

		expect( up.length ).toBeGreaterThan( 0 );
		for ( const y of up ) expect( y ).toBeCloseTo( roof, 3 );

	} );

	/**
	 * Connections plans a link against the massing a parcel was expected to
	 * carry. When the world stands something else - a lot merged away, or a
	 * building shorter than that massing - the link has nothing to hang from
	 * and reads as a bar floating in the air beside or above the towers.
	 */
	it( 'draws only the links the standing buildings can carry', () => {

		const everything = new Links( doc, factory ).build();
		const hosts = new Map( [ [ 'p0', 90 ], [ 'p1', 40 ], [ 'p2', 30 ], [ 'p3', 30 ], [ 'p4', 20 ] ] );
		const hosted = new Links( doc, factory, { spans: [] }, { hosts } ).build();

		// p14 is not there at all, and p1 stops 41 m below the tube on it.
		expect( everything.unhosted ).toBe( 0 );
		expect( hosted.unhosted ).toBe( 2 );
		expect( hosted.triangles ).toBeLessThan( everything.triangles );

		const kept = doc.links.filter( ( link ) => [ link.a, link.b ].every( ( end, at ) => {

			const roof = hosts.get( end.buildingId );
			return roof !== undefined && link.path[ at ? link.path.length - 1 : 0 ][ 1 ] <= roof;

		} ) );

		expect( kept.map( ( link ) => link.id ).sort() ).toEqual( [ 'l0', 'l10', 'l20', 'l9' ] );
		// Nothing is left standing above the roofs that carry it.
		expect( topOf( everything.group ) ).toBeGreaterThan( 85 );
		expect( topOf( hosted.group ) ).toBeLessThan( 40 );

	} );

	it( 'renders rooftop span thickness, catenary samples and exact mast endpoints', async () => {

		const request = JSON.parse( readFileSync( ROOFTOP_FIXTURE, 'utf8' ) );
		const rooftop = await ( await import( '../../../../connections/src/index.ts' ) ).generateRooftopSpans( request );

		for ( const span of rooftop.spans ) {

			const built = new Links( { links: [], apertures: [] }, factory, { ...rooftop, spans: [ span ] } ).build();
			const geometry = built.group.children[ 0 ].geometry;
			const position = geometry.getAttribute( 'position' );
			const uv = geometry.getAttribute( 'uv' );
			const stations = pathStations( span.path );

			expect( built.drawCalls ).toBe( 1 );
			expect( built.colliderGeometry ).toBe( null );
			expect( built.triangles ).toBe( ROOFTOP_WIRE_SIDES * ( span.path.length - 1 ) * 2 );
			for ( let i = 0; i < span.path.length; i ++ ) {

				const ring = pointsAtStation( position, uv, stations[ i ] );
				const center = average( ring );

				expect( ring ).toHaveLength( ROOFTOP_WIRE_SIDES );
				expect( center ).toEqual( expectCloseToPoint( span.path[ i ], 4 ) );
				for ( const point of ring ) expect( distance( point, span.path[ i ] ) ).toBeCloseTo( span.thickness / 2, 4 );

			}

		}

	} );

	/**
	 * A skybridge is walked through and never over: Connections publishes a
	 * 4 x 3.2 m corridor and the aperture is the doorway into it. Drawn as
	 * anything less than a closed box it reads from the street as a slab
	 * spanning the gap with the sky where its roof should be, and the glazed
	 * band is what tells you people cross inside it.
	 */
	it( 'draws a bridge as an enclosed glazed box', () => {

		const bridge = doc.links.find( ( link ) => link.kind === 'bridge' && level( link ) );
		const built = new Links( { links: [ bridge ], apertures: doc.apertures }, factory ).build();
		const shell = meshFor( built, 'cyberpunk/concrete/mid' ).geometry;
		const glass = meshFor( built, 'cyberpunk/window-glass/mid' ).geometry;
		const floor = bridge.path[ 0 ][ 1 ] - bridge.crossSection.height / 2;
		const open = openEdges( [ shell, glass ] );

		// The only holes are the two doorways: eight open edges close a loop
		// round each end and every one of them lies on that aperture's plane.
		expect( open ).toHaveLength( 16 );
		for ( const point of open.flat() ) expect( onEndPlane( point, bridge, doc.apertures ) ).toBe( true );

		// Floor, walls and roof fill the published section, and the band sits
		// at eye level on both walls.
		expect( extent( shell, 1 ) ).toEqual( [ expect.closeTo( floor, 3 ), expect.closeTo( floor + bridge.crossSection.height, 3 ) ] );
		expect( extent( glass, 1 ) ).toEqual( [ expect.closeTo( floor + 0.9, 3 ), expect.closeTo( floor + 2.3, 3 ) ] );
		expect( glass.getAttribute( 'position' ).count / 3 ).toBe( 4 * ( bridge.path.length - 1 ) );

	} );

	/**
	 * A duct is a tube. Connections publishes a 2 x 2.4 m rect section walked
	 * through and over, so all four flats have to be there: a face missing
	 * leaves a beam you can see the hollow of from the street below.
	 */
	it( 'draws a duct as a closed tube', () => {

		const tube = doc.links.find( ( link ) => link.kind === 'ac-tube' && level( link ) );
		const built = new Links( { links: [ tube ], apertures: doc.apertures }, factory ).build();
		const geometry = meshFor( built, 'cyberpunk/metal/mid' ).geometry;
		const base = doc.apertures.find( ( aperture ) => aperture.id === tube.a.apertureId ).base;
		const open = openEdges( [ geometry ] );

		expect( built.drawCalls ).toBe( 1 );
		expect( faceNormals( geometry ) ).toHaveLength( 4 );
		expect( extent( geometry, 1 ) ).toEqual( [ expect.closeTo( base, 3 ), expect.closeTo( base + tube.crossSection.height, 3 ) ] );
		expect( open ).toHaveLength( 8 );
		for ( const point of open.flat() ) expect( onEndPlane( point, tube, doc.apertures ) ).toBe( true );

	} );

	/**
	 * Every link in the city is one batch per material and never one per link:
	 * the 1 km city publishes hundreds of them, and a submission each would
	 * land on top of what the skyline already spends.
	 */
	it( 'merges every link into one batch per material', () => {

		const built = new Links( doc, factory ).build();
		const names = built.group.children.map( ( mesh ) => mesh.name );
		const alone = doc.links.reduce(
			( total, link ) => total + new Links( { links: [ link ], apertures: doc.apertures }, factory ).build().triangles, 0
		);

		expect( built.drawCalls ).toBe( names.length );
		expect( new Set( names ) ).toEqual( new Set( [
			'links:cyberpunk/concrete/mid', 'links:cyberpunk/window-glass/mid',
			'links:cyberpunk/metal/mid', 'links:cyberpunk/rubber/mid'
		] ) );
		expect( names.length ).toBeLessThan( doc.links.length );
		// Batched and not thinned: every triangle a link draws alone is in there.
		expect( built.triangles ).toBe( alone );

	} );

} );

/** The highest point anything in this group reaches. */
function topOf( group ) {

	let top = - Infinity;

	for ( const mesh of group.children ) {

		const position = mesh.geometry.getAttribute( 'position' );
		for ( let i = 0; i < position.count; i ++ ) top = Math.max( top, position.getY( i ) );

	}

	return top;

}

function pathStations( path ) {

	const stations = [ 0 ];
	for ( let i = 1; i < path.length; i ++ ) stations.push( stations[ i - 1 ] + distance( path[ i ], path[ i - 1 ] ) );

	return stations;

}

function pointsAtStation( position, uv, station ) {

	const points = new Map();
	for ( let i = 0; i < uv.count; i ++ ) {

		if ( Math.abs( uv.getX( i ) - station ) > 1e-4 ) continue;
		const point = [ position.getX( i ), position.getY( i ), position.getZ( i ) ];
		points.set( point.map( ( value ) => value.toFixed( 6 ) ).join( ':' ), point );

	}

	return [ ...points.values() ];

}

function average( points ) {

	return points[ 0 ].map( ( _, axis ) => points.reduce( ( sum, point ) => sum + point[ axis ], 0 ) / points.length );

}

function distance( a, b ) {

	return Math.hypot( ...a.map( ( value, axis ) => value - b[ axis ] ) );

}

function expectCloseToPoint( point, digits ) {

	return point.map( ( value ) => expect.closeTo( value, digits ) );

}

/** A link whose two ends sit at the same height, so its roof is one plane. */
function level( link ) {

	return link.path[ 0 ][ 1 ] === link.path[ link.path.length - 1 ][ 1 ];

}

function nearest( points, [ x, y, z ] ) {

	let best = Infinity;

	for ( const point of points ) {

		best = Math.min( best, Math.hypot( point[ 0 ] - x, point[ 1 ] - y, point[ 2 ] - z ) );

	}

	return best;

}

/** The y of every triangle in a collider whose face points straight up. */
function upwardFacing( geometry ) {

	const position = geometry.getAttribute( 'position' );
	const out = [];

	for ( let i = 0; i < position.count; i += 3 ) {

		const a = [ position.getX( i ), position.getY( i ), position.getZ( i ) ];
		const b = [ position.getX( i + 1 ), position.getY( i + 1 ), position.getZ( i + 1 ) ];
		const c = [ position.getX( i + 2 ), position.getY( i + 2 ), position.getZ( i + 2 ) ];
		const u = [ b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ], b[ 2 ] - a[ 2 ] ];
		const v = [ c[ 0 ] - a[ 0 ], c[ 1 ] - a[ 1 ], c[ 2 ] - a[ 2 ] ];
		const normal = [
			u[ 1 ] * v[ 2 ] - u[ 2 ] * v[ 1 ],
			u[ 2 ] * v[ 0 ] - u[ 0 ] * v[ 2 ],
			u[ 0 ] * v[ 1 ] - u[ 1 ] * v[ 0 ]
		];

		if ( normal[ 1 ] / Math.hypot( ...normal ) > 0.99 ) out.push( a[ 1 ], b[ 1 ], c[ 1 ] );

	}

	return out;

}

/** The merged mesh a material key drew. */
function meshFor( built, key ) {

	return built.group.children.find( ( mesh ) => mesh.name === `links:${key}` );

}

/** The edges only one triangle uses: where a surface is open. */
function openEdges( geometries ) {

	const used = new Map();

	for ( const geometry of geometries ) {

		const position = geometry.getAttribute( 'position' );

		for ( let triangle = 0; triangle < position.count; triangle += 3 ) {

			const points = [ 0, 1, 2 ].map( ( offset ) => [
				position.getX( triangle + offset ), position.getY( triangle + offset ), position.getZ( triangle + offset )
			] );

			for ( const [ from, to ] of [ [ 0, 1 ], [ 1, 2 ], [ 2, 0 ] ] ) {

				const edge = [ points[ from ], points[ to ] ];
				const id = edge.map( rounded ).sort().join( '|' );

				used.set( id, { edge, count: ( used.get( id )?.count ?? 0 ) + 1 } );

			}

		}

	}

	return [ ...used.values() ].filter( ( entry ) => entry.count === 1 ).map( ( entry ) => entry.edge );

}

function rounded( values ) {

	return values.map( ( value ) => ( Math.abs( value ) < 1e-6 ? 0 : value ).toFixed( 4 ) ).join( ':' );

}

/** [ min, max ] of one axis over a geometry. */
function extent( geometry, axis ) {

	const position = geometry.getAttribute( 'position' );
	let min = Infinity;
	let max = - Infinity;

	for ( let i = 0; i < position.count; i ++ ) {

		const value = position.array[ i * 3 + axis ];

		min = Math.min( min, value );
		max = Math.max( max, value );

	}

	return [ min, max ];

}

/** The distinct directions the faces of a geometry point in. */
function faceNormals( geometry ) {

	const normal = geometry.getAttribute( 'normal' );
	const directions = new Set();

	for ( let i = 0; i < normal.count; i ++ ) directions.add( rounded( [ normal.getX( i ), normal.getY( i ), normal.getZ( i ) ] ) );

	return [ ...directions ];

}

/** Whether a point sits on the plane of one of a link's two aperture cuts. */
function onEndPlane( point, link, apertures ) {

	return [ link.a, link.b ].some( ( end ) => {

		const polygon = apertures.find( ( aperture ) => aperture.id === end.apertureId ).cut.polygon;
		const normal = newell( polygon );

		return Math.abs( normal.reduce( ( sum, value, axis ) => sum + value * ( point[ axis ] - polygon[ 0 ][ axis ] ), 0 ) ) < 1e-3;

	} );

}

function newell( polygon ) {

	const normal = [ 0, 0, 0 ];

	for ( let i = 0; i < polygon.length; i ++ ) {

		const a = polygon[ i ];
		const b = polygon[ ( i + 1 ) % polygon.length ];

		normal[ 0 ] += ( a[ 1 ] - b[ 1 ] ) * ( a[ 2 ] + b[ 2 ] );
		normal[ 1 ] += ( a[ 2 ] - b[ 2 ] ) * ( a[ 0 ] + b[ 0 ] );
		normal[ 2 ] += ( a[ 0 ] - b[ 0 ] ) * ( a[ 1 ] + b[ 1 ] );

	}

	const length = Math.hypot( ...normal );

	return normal.map( ( value ) => value / length );

}
