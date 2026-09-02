import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { PbrMaterialFactory } from '../../building/PbrMaterialFactory.js';
import { runConnections } from '../../assembly/connectionsRunner.js';
import { Links, RAILING } from './Links.js';

const ATLAS_SAMPLE = new URL( '../../../../atlas/samples/city-urbe-small.json', import.meta.url );
/** Mirrors the wire tube's side count, so the triangle accounting is exact. */
const WIRE_SIDES = 5;
const PROMISED_DRAW_CALLS = 3;

/** No theme is served under node, so every key falls back. Keys still differ. */
const factory = new PbrMaterialFactory( { resolve: () => null, mapUrl: () => '' } );

describe( 'Links', () => {

	let doc;

	beforeAll( async () => {

		const atlas = JSON.parse( readFileSync( ATLAS_SAMPLE, 'utf8' ) );
		doc = await runConnections( atlas, { seed: atlas.meta.seed } );

	} );

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
	 * The reason this box merges at all: the city's link budget is a fixed
	 * handful of draw calls whatever the city does, and every link is inside
	 * them rather than quietly dropped on the way.
	 */
	it( 'draws every link in the city in three calls', () => {

		const built = new Links( doc, factory ).build();

		expect( built.drawCalls ).toBe( PROMISED_DRAW_CALLS );
		expect( built.group.children.length ).toBe( PROMISED_DRAW_CALLS );

		// A closed section sweeps one strip per side, an open deck one fewer:
		// railing, deck, railing, and nothing over the top.
		const sides = ( link ) => {

			if ( link.crossSection.shape !== 'rect' ) return WIRE_SIDES;

			return link.kind === 'bridge' ? 3 : 4;

		};

		const expected = doc.links.reduce(
			( sum, link ) => sum + sides( link ) * ( link.path.length - 1 ) * 2,
			0
		);

		expect( built.triangles ).toBe( expected );

	} );

	/**
	 * Every material a link wears tiles over world-metre UVs. A primitive's
	 * 0..1 unwrap would stretch a single 3 m concrete tile over a whole
	 * twenty-metre bridge.
	 */
	it( 'unwraps in world metres', () => {

		const bridge = doc.links.find( ( link ) => link.kind === 'bridge' && level( link ) );
		const geometry = new Links( { links: [ bridge ], apertures: doc.apertures }, factory )
			.build().group.children[ 0 ].geometry;
		const uv = geometry.getAttribute( 'uv' );
		const position = geometry.getAttribute( 'position' );

		let along = [ Infinity, - Infinity ];
		let across = [ Infinity, - Infinity ];
		const axis = unit( bridge.path[ 0 ], bridge.path[ 1 ] );

		for ( let i = 0; i < uv.count; i ++ ) {

			along = [ Math.min( along[ 0 ], uv.getX( i ) ), Math.max( along[ 1 ], uv.getX( i ) ) ];
			across = [ Math.min( across[ 0 ], uv.getY( i ) ), Math.max( across[ 1 ], uv.getY( i ) ) ];
			const point = [ position.getX( i ), position.getY( i ), position.getZ( i ) ];
			expect( uv.getX( i ) ).toBeCloseTo( projection( point, bridge.path[ 0 ], axis ), 3 );

		}

		// Railing, deck, railing across the section.
		expect( across[ 1 ] - across[ 0 ] ).toBeCloseTo( bridge.crossSection.width + 2 * RAILING, 3 );
		// The two wall mitres may extend by more than one section between them.
		// U is the exact metre projection along the straight link axis, including
		// those cuts, rather than an arbitrary bound around centerline length.
		expect( along[ 1 ] - along[ 0 ] ).toBeGreaterThan( bridge.length );

	} );

} );

function unit( a, b ) {

	const vector = b.map( ( value, i ) => value - a[ i ] );
	const length = Math.hypot( ...vector );

	return vector.map( ( value ) => value / length );

}

function projection( point, origin, axis ) {

	return point.reduce( ( sum, value, i ) => sum + ( value - origin[ i ] ) * axis[ i ], 0 );

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
