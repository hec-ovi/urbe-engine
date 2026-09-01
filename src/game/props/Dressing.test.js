import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { runConnections } from '../../assembly/connectionsRunner.js';
import { pointInRing } from '../ground/Polygons.js';
import { SIDEWALK_HEIGHT } from '../ground/GroundBuilder.js';
import { CLEARANCE } from './Clearance.js';
import { Dressing } from './Dressing.js';

const SAMPLE = new URL( '../../../../atlas/samples/city-urbe-small.json', import.meta.url );
const factory = { build: () => null, variant: () => null };

/**
 * Two promises, and the city is the only fair test of either: the same world
 * dresses the same way every time it is opened, and nothing the pass puts down
 * stands where a person has to walk or where a door has to open.
 */
describe( 'Dressing', () => {

	let atlas;
	let walk;
	let props;

	beforeAll( async () => {

		atlas = JSON.parse( fs.readFileSync( SAMPLE, 'utf8' ) );
		walk = ( await runConnections( atlas, { seed: atlas.meta.seed } ) ).networks.walk;
		props = new Dressing( atlas, walk, factory ).build();

	} );

	it( 'dresses the same city the same way twice', () => {

		const again = new Dressing( atlas, walk, factory ).build();

		expect( again.counts ).toEqual( props.counts );
		expect( again.counts.total ).toBeGreaterThan( 0 );

		for ( let i = 0; i < props.group.children.length; i ++ ) {

			expect( [ ...again.group.children[ i ].instanceMatrix.array ] )
				.toEqual( [ ...props.group.children[ i ].instanceMatrix.array ] );

		}

	} );

	it( 'never stands a prop in a building, a doorway or a walking line', () => {

		const lines = walk.edges.flatMap( ( edge ) => legs( edge.path ) );
		const wrong = [];

		for ( const { name, x, y, z } of standing( props.group ) ) {

			// The transforms come back through a float32 buffer, so the pavement
			// height itself arrives a hair under what it went in as.
			if ( y < SIDEWALK_HEIGHT - 0.001 ) wrong.push( `${name} under the pavement` );

			if ( atlas.parcels.some( ( p ) => pointInRing( x, z, p.footprint ) ) ) wrong.push( `${name} inside a building` );

			for ( const parcel of atlas.parcels ) {

				const [ dx, dz ] = parcel.access.point;

				if ( Math.hypot( x - dx, z - dz ) < CLEARANCE.door ) wrong.push( `${name} in ${parcel.id}'s doorway` );

			}

			for ( const leg of lines ) {

				if ( toSegment( x, z, leg ) < CLEARANCE.walk ) wrong.push( `${name} on a walking line` );

			}

		}

		expect( wrong.slice( 0, 5 ) ).toEqual( [] );

	} );

	it( 'costs one draw call per model and gives the solid props a collider', () => {

		const names = props.group.children.map( ( mesh ) => mesh.name );

		expect( names ).toEqual( [ 'props:bag', 'props:crate', 'props:box' ] );

		for ( const mesh of props.group.children ) {

			expect( mesh.isInstancedMesh ).toBe( true );
			expect( mesh.count ).toBe( props.counts[ mesh.name.split( ':' )[ 1 ] ] );

		}

		// Crates and boxes are twelve triangles of collider each; a bag is soft
		// and hands the physics world nothing at all.
		const solid = props.colliders.get( 'props' );
		const solids = props.counts.crate + props.counts.box;

		expect( solid.getAttribute( 'position' ).count / 3 ).toBe( solids * 12 );
		expect( solid.getAttribute( 'normal' ) ).toBeUndefined();

	} );

} );

/** Every prop the group holds, as its model name and where it stands. */
function standing( group ) {

	const out = [];

	for ( const mesh of group.children ) {

		const matrices = mesh.instanceMatrix.array;

		for ( let i = 0; i < mesh.count; i ++ ) {

			out.push( {
				name: `${mesh.name} ${i}`,
				x: matrices[ i * 16 + 12 ],
				y: matrices[ i * 16 + 13 ],
				z: matrices[ i * 16 + 14 ]
			} );

		}

	}

	return out;

}

function legs( path ) {

	const out = [];

	for ( let i = 0; i < path.length - 1; i ++ ) out.push( [ path[ i ], path[ i + 1 ] ] );

	return out;

}

function toSegment( x, z, [ [ ax, az ], [ bx, bz ] ] ) {

	const dx = bx - ax;
	const dz = bz - az;
	const t = Math.max( 0, Math.min( 1, ( ( x - ax ) * dx + ( z - az ) * dz ) / ( dx * dx + dz * dz || 1 ) ) );

	return Math.hypot( x - ( ax + dx * t ), z - ( az + dz * t ) );

}
