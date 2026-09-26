import { describe, expect, it } from 'vitest';
import { DressingObstacles } from './DressingObstacles.js';

const square = ( x, z, half ) => [ [ x - half, z - half ], [ x + half, z - half ], [ x + half, z + half ], [ x - half, z + half ] ];

describe( 'street obstacles', () => {

	it( 'keeps a street feature but not a tree grate, and stands a tree where its trunk and low branches are rather than under its crown', () => {

		expect( DressingObstacles.fromFeatures( [
			{ kind: 'bollard', footprint: square( 4, 2, 0.1 ), bounds: { min: [ 3.9, 0.2, 1.9 ], max: [ 4.1, 1.1, 2.1 ] } },
			{ kind: 'tree-grate', footprint: square( 8, 2, 0.6 ), bounds: { min: [ 7.4, 0.2, 1.4 ], max: [ 8.6, 0.22, 2.6 ] } }
		] ) ).toEqual( [ { footprint: square( 4, 2, 0.1 ), bottom: 0.2, top: 1.1 } ] );

		expect( DressingObstacles.fromPlacements( [
			{ kind: 'bench', footprint: square( 0, 0, 0.8 ), lowFootprint: square( 0, 0, 0.8 ), bottom: 0.2, top: 0.7 },
			{ kind: 'tree', footprint: square( 8, 2, 2.5 ), lowFootprint: square( 8, 2, 0.4 ), bottom: 0.2, top: 7 }
		] ) ).toEqual( [
			{ footprint: square( 0, 0, 0.8 ), bottom: 0.2, top: 0.7 },
			{ footprint: square( 8, 2, 0.4 ), bottom: 0.2, top: 7 }
		] );

	} );

} );
