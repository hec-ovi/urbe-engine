import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { StationVolumes, stairPlan } from './StationVolumes.js';
import { SIDEWALK_HEIGHT } from '../ground/GroundBuilder.js';

const factory = { build: () => new THREE.MeshStandardMaterial(), variant: () => new THREE.MeshStandardMaterial() };
const quad = ( x0, z0, x1, z1 ) => [ [ x0, z0 ], [ x1, z0 ], [ x1, z1 ], [ x0, z1 ] ];

/** A subway box 12 m down with one shaft standing inside its own platform. */
const under = ( shafts ) => ( {
	id: 'ss0', position: [ 10, 20 ], districtId: 'd0', level: - 12,
	box: { bottom: - 12, top: - 7 },
	platform: quad( 0, 16, 40, 24 ),
	entrances: [ [ 10, 20 ] ],
	shafts
} );

const inPlatform = { footprint: quad( 6, 19, 14, 21.5 ), top: 0, bottom: - 12, passage: [] };
const outside = { footprint: quad( 6, 30, 14, 32.5 ), top: 0, bottom: - 12, passage: quad( 8, 24, 12, 30 ) };

const city = ( ...subway ) => ( { transit: { trainStations: [], subwayStations: subway } } );
const built = ( atlas ) => new StationVolumes( atlas, factory ).build();
const meshY = ( group, name ) => span( group.getObjectByName( name ).geometry );

/**
 * The entrances led nowhere: the atlas has published the volumes behind them
 * all along. What has to hold for a player to walk down and stand on a
 * platform: the stair reaches the bottom in steps the controller can take, the
 * room is a floor at the published level, a shaft standing in its platform
 * opens through the ceiling rather than into rock, a shaft outside one reaches
 * it through the published passage, and none of it is pitch dark.
 */
describe( 'StationVolumes', () => {

	it( 'builds nothing for a city with no stations', () => {

		const { group, glows, collider } = built( { transit: {} } );

		expect( group.children ).toEqual( [] );
		expect( glows ).toEqual( [] );
		expect( collider ).toBe( null );

	} );

	it( 'fits the drop into the footprint in steps the controller can take', () => {

		const plan = stairPlan( 8, SIDEWALK_HEIGHT, - 12 );

		expect( plan.treads ).toBe( 18 );
		expect( plan.flights ).toBe( 4 );
		expect( plan.rise ).toBeLessThanOrEqual( 0.19 );
		expect( plan.rise * plan.treads * plan.flights ).toBeCloseTo( 12.12, 6 );
		// One flight has to fit inside the footprint it switchbacks in.
		expect( plan.run ).toBeLessThan( 8 );

	} );

	it( 'walks from the pavement down to the shaft floor and out onto the platform', () => {

		const { group } = built( city( under( [ inPlatform ] ) ) );

		// Treads, landings and the platform slab are all floor: the highest is
		// the mouth at pavement level, the lowest the platform at its own.
		expect( meshY( group, 'station:floor' ) ).toEqual( [ - 12.2, SIDEWALK_HEIGHT ] );

	} );

	it( 'opens the room ceiling where its own shaft comes through', () => {

		const holed = built( city( under( [ inPlatform ] ) ) ).group.getObjectByName( 'station:structure' );
		const whole = built( city( under( [] ) ) ).group.getObjectByName( 'station:structure' );

		expect( covered( whole.geometry, 10, 20, - 7 ) ).toBe( true );
		expect( covered( holed.geometry, 10, 20, - 7 ) ).toBe( false );
		// Ceiling either side of the hole stays.
		expect( covered( holed.geometry, 30, 20, - 7 ) ).toBe( true );

	} );

	it( 'opens the shaft and the room where the published passage joins them', () => {

		const linked = built( city( under( [ outside ] ) ) ).group.getObjectByName( 'station:structure' );
		const sealed = built( city( under( [ { ...outside, passage: [] } ] ) ) ).group.getObjectByName( 'station:structure' );

		// The platform's long wall runs along z = 24; the passage crosses it at x = 10.
		expect( wallAt( sealed.geometry, 10, 24 ) ).toBe( true );
		expect( wallAt( linked.geometry, 10, 24 ) ).toBe( false );
		expect( wallAt( linked.geometry, 30, 24 ) ).toBe( true );

	} );

	it( 'gives a platform already at street level a canopy instead of a room', () => {

		const surface = {
			id: 'ts0', position: [ 10, 20 ], level: 0, box: { bottom: 0, top: 3 },
			platform: quad( 0, 16, 40, 24 ), entrances: [ [ 10, 20 ] ], shafts: []
		};
		const { group } = built( { transit: { trainStations: [ surface ], subwayStations: [] } } );

		expect( group.getObjectByName( 'station:floor' ) ).toBeUndefined();
		expect( meshY( group, 'station:structure' ) ).toEqual( [ 0, 3 ] );

	} );

	it( 'lights the platform and every landing, so nothing underground is a black hole', () => {

		const { glows } = built( city( under( [ inPlatform ] ) ) );

		expect( glows.length ).toBeGreaterThan( 3 );
		expect( glows.every( ( glow ) => glow.lumens > 0 && glow.range > 0 ) ).toBe( true );
		expect( glows.some( ( glow ) => glow.position.y < - 7 ) ).toBe( true );

	} );

} );

/** The y range a geometry occupies, rounded to the centimetre. */
function span( geometry ) {

	const position = geometry.getAttribute( 'position' );
	let low = Infinity;
	let high = - Infinity;

	for ( let i = 0; i < position.count; i ++ ) {

		low = Math.min( low, position.getY( i ) );
		high = Math.max( high, position.getY( i ) );

	}

	return [ Math.round( low * 100 ) / 100, Math.round( high * 100 ) / 100 ];

}

/** Whether a horizontal triangle at height y covers the point. */
function covered( geometry, x, z, y ) {

	return triangles( geometry ).some( ( [ a, b, c ] ) =>
		[ a, b, c ].every( ( p ) => Math.abs( p[ 1 ] - y ) < 1e-3 ) && inTriangle( x, z, flat( a ), flat( b ), flat( c ) ) );

}

/**
 * Whether a wall stands over the point. A vertical triangle is a line in plan,
 * not an area, so this is a distance to that line rather than containment.
 */
function wallAt( geometry, x, z, tolerance = 0.05 ) {

	return triangles( geometry ).some( ( [ a, b, c ] ) => {

		if ( new Set( [ a, b, c ].map( ( p ) => Math.round( p[ 1 ] * 100 ) ) ).size < 2 ) return false;

		const plan = [ flat( a ), flat( b ), flat( c ) ];
		const [ p, q ] = ends( plan );

		return toSegment( x, z, p, q ) <= tolerance;

	} );

}

/** The two furthest-apart plan points of a triangle: a wall quad's own footprint line. */
function ends( points ) {

	let best = [ points[ 0 ], points[ 1 ] ];
	let far = - 1;

	for ( const p of points ) {

		for ( const q of points ) {

			const d = Math.hypot( q[ 0 ] - p[ 0 ], q[ 1 ] - p[ 1 ] );

			if ( d > far ) {

				far = d;
				best = [ p, q ];

			}

		}

	}

	return best;

}

function toSegment( x, z, p, q ) {

	const dx = q[ 0 ] - p[ 0 ];
	const dz = q[ 1 ] - p[ 1 ];
	const length = dx * dx + dz * dz;
	const t = length > 0 ? Math.max( 0, Math.min( 1, ( ( x - p[ 0 ] ) * dx + ( z - p[ 1 ] ) * dz ) / length ) ) : 0;

	return Math.hypot( x - ( p[ 0 ] + t * dx ), z - ( p[ 1 ] + t * dz ) );

}

function triangles( geometry ) {

	const position = geometry.getAttribute( 'position' );
	const index = geometry.index;
	const count = index ? index.count : position.count;
	const at = ( i ) => {

		const v = index ? index.getX( i ) : i;

		return [ position.getX( v ), position.getY( v ), position.getZ( v ) ];

	};
	const out = [];

	for ( let i = 0; i < count; i += 3 ) out.push( [ at( i ), at( i + 1 ), at( i + 2 ) ] );

	return out;

}

const flat = ( p ) => [ p[ 0 ], p[ 2 ] ];

function inTriangle( x, z, a, b, c ) {

	const side = ( p, q ) => ( q[ 0 ] - p[ 0 ] ) * ( z - p[ 1 ] ) - ( q[ 1 ] - p[ 1 ] ) * ( x - p[ 0 ] );
	const s = [ side( a, b ), side( b, c ), side( c, a ) ];

	return s.every( ( v ) => v >= 0 ) || s.every( ( v ) => v <= 0 );

}
