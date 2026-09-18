import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PbrMaterialFactory } from '../../building/PbrMaterialFactory.js';
import { Links, ROOFTOP_WIRE_SIDES } from './Links.js';

const CONNECTIONS_FIXTURE = new URL( './links.fixture.json', import.meta.url );
const ROOFTOP_FIXTURE = new URL( '../../../../connections/fixtures/rooftop-spans.request.json', import.meta.url );

/** No theme is served under node, so every key falls back. Keys still differ. */
const factory = new PbrMaterialFactory( { resolve: () => null, mapUrl: () => '' } );

describe( 'Links', () => {

	const doc = JSON.parse( readFileSync( CONNECTIONS_FIXTURE, 'utf8' ) );

	/**
	 * The one thing a link cannot get wrong. The facade is carved with the
	 * aperture's cut polygon; a sweep cut square to its own axis instead of to
	 * the wall misses that hole by centimetres on every diagonal link, which is
	 * a gap you can see daylight through or a tube poking out of a wall.
	 *
	 * A closed link meets all four corners of its cut. A bridge is an open deck,
	 * so it meets the two at the base, which is the walking surface landing on
	 * the floor plate the exterior box aligned to that aperture; above them the
	 * opening is open, which is the point.
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
		let decks = 0;

		for ( const link of doc.links ) {

			if ( link.crossSection.shape !== 'rect' ) continue;

			for ( const end of [ link.a, link.b ] ) {

				const polygon = cuts.get( end.apertureId );
				const wanted = link.kind === 'bridge' ? base( polygon ) : polygon;

				if ( link.kind === 'bridge' ) decks ++;

				for ( const vertex of wanted ) worst = Math.max( worst, nearest( points, vertex ) );

			}

		}

		expect( decks ).toBeGreaterThan( 0 );
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

/** The two lowest corners of a cut polygon: the edge a deck lands on. */
function base( polygon ) {

	const low = Math.min( ...polygon.map( ( vertex ) => vertex[ 1 ] ) );

	return polygon.filter( ( vertex ) => vertex[ 1 ] - low < 1e-6 );

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
