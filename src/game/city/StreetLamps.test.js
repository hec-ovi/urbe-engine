import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { runConnections } from '../../assembly/connectionsRunner.js';
import { pointInRing } from '../ground/Polygons.js';
import { kelvinColor } from '../light/Color.js';
import { StreetLamps, WALL_LUMENS, streetLampAssembly } from './StreetLamps.js';

const SAMPLE = new URL( '../../../../atlas/samples/city-urbe-small.json', import.meta.url );
const MIN_GAP = 6;
const factory = { build: () => null, variant: () => null };

/**
 * The promise is coverage: a player walking the city is never on a stretch that
 * no fixture reaches, and the fixtures that make that true hang on real walls.
 * The city itself is the only fair test of it, so this runs against the small
 * sample blueprint and its real walk graph.
 */
describe( 'StreetLamps', () => {

	let atlas;
	let lamps;
	let walk;

	beforeAll( async () => {

		atlas = JSON.parse( fs.readFileSync( SAMPLE, 'utf8' ) );
		walk = ( await runConnections( atlas, { seed: atlas.meta.seed } ) ).networks.walk;
		lamps = new StreetLamps( atlas, factory, walk ).build();

	} );

	it( 'leaves no walkable metre of the city out of reach of a fixture', () => {

		const lit = reachTest( lamps.glows );
		const dark = [];

		for ( const edge of walk.edges ) {

			// Bridges and tunnels run inside their own structure, over the
			// street or under it, and no street fixture lights either.
			if ( edge.kind === 'link' ) continue;

			for ( const [ x, z ] of samples( edge.path, 0.5 ) ) {

				if ( ! lit( x, z ) ) dark.push( `${edge.kind} ${edge.id} at ${x.toFixed( 1 )}, ${z.toFixed( 1 )}` );

			}

		}

		expect( dark.slice( 0, 5 ) ).toEqual( [] );

		// The alleys are the stretches posts cannot serve, so the rule has to
		// have put something on them.
		expect( lamps.glows.filter( ( g ) => g.lumens === WALL_LUMENS ).length ).toBeGreaterThan( 0 );

	} );

	it( 'brackets every wall fixture to a real facade', () => {

		for ( const fixture of lamps.glows.filter( ( g ) => g.lumens === WALL_LUMENS ) ) {

			const { x, y, z } = fixture.position;

			expect( y ).toBeGreaterThan( 3.5 );
			expect( y ).toBeLessThan( 4.5 );

			// On the outside of a wall it can actually be bolted to: within the
			// bracket's own reach of a facade, and not inside the building.
			expect( Math.min( ...atlas.parcels.map( ( p ) => toRing( x, z, p.footprint ) ) ) ).toBeLessThan( 0.5 );
			expect( atlas.parcels.some( ( p ) => pointInRing( x, z, p.footprint ) ) ).toBe( false );

		}

	} );

	it( 'stands every post on the kerb side of the roadway the atlas drew', () => {

		const roadway = atlas.volumetric.ground.filter( ( cover ) => cover.surface === 'roadway' ).map( ( cover ) => cover.polygon );
		const onAsphalt = lamps.posts.filter( ( post ) => roadway.some( ( ring ) => pointInRing( post.x, post.z, ring ) ) );

		// A junction or a wide road swallows the fixed kerb offset; the post
		// has to step back onto the pavement rather than stand in the lane.
		expect( onAsphalt.slice( 0, 5 ).map( ( p ) => `${p.x.toFixed( 1 )}, ${p.z.toFixed( 1 )}` ) ).toEqual( [] );
		expect( lamps.posts.length ).toBeGreaterThan( 100 );

	} );

	it( 'keeps the posts it had: none in a plaza, none within six metres of another, none in an alley', () => {

		const plazas = atlas.volumetric.ground.filter( ( c ) => c.surface === 'open' ).map( ( c ) => c.polygon );
		const alleys = atlas.streets.edges.filter( ( e ) => e.class === 'alley' );
		const posts = lamps.posts;
		const wrong = [];

		expect( posts.length ).toBeGreaterThan( 100 );

		for ( let i = 0; i < posts.length; i ++ ) {

			const post = posts[ i ];

			// The ring of posts around a plaza's edge stands on the ring itself,
			// so a post only counts as in the plaza once it is inside it.
			const plaza = plazas.find( ( ring ) => pointInRing( post.x, post.z, ring ) );

			if ( plaza && toRing( post.x, post.z, plaza ) > 1.5 ) wrong.push( `${i} in a plaza` );

			for ( const alley of alleys ) {

				const half = alley.width / 2 + Math.max( alley.sidewalk.left, alley.sidewalk.right );

				if ( toPath( post.x, post.z, alley.path ) < half ) wrong.push( `${i} in alley ${alley.id}` );

			}

			for ( let j = i + 1; j < posts.length; j ++ ) {

				if ( Math.hypot( post.x - posts[ j ].x, post.z - posts[ j ].z ) < MIN_GAP ) wrong.push( `${i} on top of ${j}` );

			}

		}

		expect( wrong.slice( 0, 5 ) ).toEqual( [] );

	} );

	it( 'turns the complete long-head assembly with the served route', () => {

		for ( const [ ax, az ] of [ [ 1, 0 ], [ 0, 1 ], [ - 1, 0 ], [ 0, - 1 ] ] ) {

			const fixture = streetLampAssembly( { x: 4, z: 7, ax, az } );
			const { head } = fixture.post;
			const fromPost = head.center.clone().sub( new THREE.Vector3( 4, head.center.y, 7 ) );

			expect( fixture.glow.lumens ).toBe( 24000 );
			expect( fixture.glow.color ).toEqual( kelvinColor( 5000 ) );
			expect( head.length ).toBeGreaterThan( 1.5 );
			expect( fromPost.dot( head.aim ) ).toBeGreaterThan( 1.2 );
			expect( Math.abs( fromPost.x * head.aim.z - fromPost.z * head.aim.x ) ).toBeLessThan( 1e-6 );
			expect( fixture.glow.position.x ).toBeCloseTo( head.center.x, 6 );
			expect( fixture.glow.position.z ).toBeCloseTo( head.center.z, 6 );

			for ( const lens of fixture.lenses ) {

				const normal = lens.getAttribute( 'normal' );
				const position = lens.getAttribute( 'position' );
				const uv = lens.getAttribute( 'uv' );

				for ( let i = 0; i < normal.count; i ++ ) {

					expect( normal.getY( i ) ).toBeCloseTo( - 1, 6 );
					expect( position.getY( i ) ).toBeCloseTo( head.underside - 0.001, 6 );

				}

				expect( attributeSpan( uv, 'x' ) ).toBeCloseTo( 0.16, 6 );
				expect( attributeSpan( uv, 'y' ) ).toBeCloseTo( 0.28, 6 );

			}

		}

	} );

} );

function attributeSpan( attribute, component ) {

	const get = component === 'x' ? ( i ) => attribute.getX( i ) : ( i ) => attribute.getY( i );
	let min = Infinity;
	let max = - Infinity;

	for ( let i = 0; i < attribute.count; i ++ ) {

		min = Math.min( min, get( i ) );
		max = Math.max( max, get( i ) );

	}

	return max - min;

}

/**
 * Whether any fixture reaches a point, over a grid wider than the widest range
 * in the set, so half a million samples stay a test rather than a wait.
 */
function reachTest( glows ) {

	const cell = 30;
	const cells = new Map();

	for ( const glow of glows ) {

		const key = `${Math.floor( glow.position.x / cell )}:${Math.floor( glow.position.z / cell )}`;

		expect( glow.range ).toBeLessThanOrEqual( cell );

		if ( ! cells.has( key ) ) cells.set( key, [] );

		cells.get( key ).push( glow );

	}

	return ( x, z ) => {

		const cx = Math.floor( x / cell );
		const cz = Math.floor( z / cell );

		for ( let dx = - 1; dx <= 1; dx ++ ) {

			for ( let dz = - 1; dz <= 1; dz ++ ) {

				for ( const glow of cells.get( `${cx + dx}:${cz + dz}` ) ?? [] ) {

					if ( Math.hypot( glow.position.x - x, glow.position.z - z ) < glow.range ) return true;

				}

			}

		}

		return false;

	};

}

/** Points every `step` metres along an [x, z] polyline, both ends included. */
function samples( path, step ) {

	const out = [];

	for ( let i = 0; i < path.length - 1; i ++ ) {

		const [ ax, az ] = path[ i ];
		const [ bx, bz ] = path[ i + 1 ];
		const steps = Math.max( 1, Math.ceil( Math.hypot( bx - ax, bz - az ) / step ) );

		for ( let s = 0; s <= steps; s ++ ) {

			out.push( [ ax + ( bx - ax ) * s / steps, az + ( bz - az ) * s / steps ] );

		}

	}

	return out;

}

function toPath( x, z, path ) {

	let best = Infinity;

	for ( let i = 0; i < path.length - 1; i ++ ) best = Math.min( best, toSegment( x, z, path[ i ], path[ i + 1 ] ) );

	return best;

}

function toRing( x, z, ring ) {

	let best = Infinity;

	for ( let i = 0; i < ring.length; i ++ ) {

		best = Math.min( best, toSegment( x, z, ring[ i ], ring[ ( i + 1 ) % ring.length ] ) );

	}

	return best;

}

function toSegment( x, z, [ ax, az ], [ bx, bz ] ) {

	const dx = bx - ax;
	const dz = bz - az;
	const t = Math.max( 0, Math.min( 1, ( ( x - ax ) * dx + ( z - az ) * dz ) / ( dx * dx + dz * dz || 1 ) ) );

	return Math.hypot( x - ( ax + dx * t ), z - ( az + dz * t ) );

}
