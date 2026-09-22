import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { GroundBuilder } from './GroundBuilder.js';
import { GroundOpenings } from './GroundOpenings.js';

const material = new THREE.MeshStandardMaterial();
const factory = { build: () => material };
const catalog = outlines => ( { buildings: outlines.map( outline => ( { bands: [ { bottom: 0, top: 4.5, outline } ] } ) ) } );
const atlas = polygon => ( { volumetric: { ground: [ { surface: 'block', polygon, top: 0.2, bottom: 0 } ] } } );
const build = ( source, outlines ) => new GroundBuilder( source, factory, { openings: new GroundOpenings( { catalog: catalog( outlines ) } ) } ).build();
const rectangle = ( x0, z0, x1, z1 ) => [ [ x0, z0 ], [ x1, z0 ], [ x1, z1 ], [ x0, z1 ] ];
const ray = ( object, x, z ) => {

	object.updateMatrixWorld( true );
	return new THREE.Raycaster( new THREE.Vector3( x, 2, z ), new THREE.Vector3( 0, - 1, 0 ) ).intersectObject( object, true );

};

describe( 'standing-building ground openings', () => {

	it( 'exposes the final review city p38 floor while retaining its actual forecourt in render and collision', () => {

		// Exact published owner 587 and composed p38 ground band from seed
		// 863c39de-9e8a-45e3-94b2-f9f296eafef9. The kit rotates -π/2;
		// its Atlas envelope is larger, and would incorrectly remove the forecourt.
		const source = atlas( rectangle( 187.2, 185.5, 307.2, 225.5 ) );
		const footprint = [ [ 300.95, 191.75 ], [ 300.95, 219.25 ], [ 273.45, 219.25 ], [ 273.45, 191.75 ] ];
		const original = structuredClone( source );
		const { group, colliderGeometry } = build( source, [ footprint ] );
		for ( const surface of [ group, new THREE.Mesh( colliderGeometry, material ) ] ) {

			expect( ray( surface, 295, 209.7 ) ).toHaveLength( 0 );
			expect( ray( surface, 272, 210 )[ 0 ].point.y ).toBeCloseTo( 0.2 );
			expect( ray( surface, 295, 189 )[ 0 ].point.y ).toBeCloseTo( 0.2 );

		}
		expect( source ).toEqual( original );

	} );

	it( 'clips rotated concave footprints across owner edges without filling the unbuilt courtyard', () => {

		const angle = 0.31, turn = ( [ x, z ] ) => [ x * Math.cos( angle ) - z * Math.sin( angle ), x * Math.sin( angle ) + z * Math.cos( angle ) ];
		const footprint = [ [ - 3, - 3 ], [ 3, - 3 ], [ 3, - 1 ], [ - 1, - 1 ], [ - 1, 3 ], [ - 3, 3 ] ].map( turn );
		const source = { volumetric: { ground: [ ...atlas( rectangle( - 6, - 6, 0, 6 ) ).volumetric.ground, ...atlas( rectangle( 0, - 6, 6, 6 ) ).volumetric.ground ] } };
		const { group, colliderGeometry } = build( source, [ footprint ] );
		for ( const surface of [ group, new THREE.Mesh( colliderGeometry, material ) ] ) {

			for ( const point of [ [ - 2, 2 ], [ - 2, - 2 ], [ 2, - 2 ] ] ) expect( ray( surface, ...turn( point ) ) ).toHaveLength( 0 );
			expect( ray( surface, ...turn( [ 2, 2 ] ) )[ 0 ].point.y ).toBeCloseTo( 0.2 );
			expect( ray( surface, 5, 5 )[ 0 ].point.y ).toBeCloseTo( 0.2 );

		}

	} );

	it( 'keeps empty lots and covers below the building datum, and supports worlds without shell catalogs', () => {

		const source = atlas( rectangle( - 5, - 5, 5, 5 ) );
		const options = { buildings: new Map( [ [ 'raised', { blueprint: { floors: [ { index: 0, elevation: 0.5, height: 3, outline: rectangle( - 2, - 2, 2, 2 ) } ] } } ] ] ) };
		const raised = new GroundBuilder( source, factory, { openings: new GroundOpenings( options ) } ).build();
		expect( ray( raised.group, 0, 0 )[ 0 ].point.y ).toBeCloseTo( 0.2 );
		const empty = build( source, [] );
		expect( ray( empty.group, 0, 0 )[ 0 ].point.y ).toBeCloseTo( 0.2 );
		options.buildings.get( 'raised' ).blueprint.floors[ 0 ].elevation = 0;
		const occupied = new GroundBuilder( source, factory, { openings: new GroundOpenings( options ) } ).build();
		expect( ray( occupied.group, 0, 0 ) ).toHaveLength( 0 );

	} );

	it( 'publishes the same opening to streamed pages and streamed collision', async () => {

		const collision = [];
		const stream = new GroundBuilder( atlas( rectangle( - 8, - 8, 8, 8 ) ), factory,
			{ openings: new GroundOpenings( { catalog: catalog( [ rectangle( - 2, - 2, 2, 2 ) ] ) } ) } ).stream();
		await stream.update( { x: 0, z: 0 }, { radius: 32, collision: {
			addBand: async ( id, chunks ) => { for ( const chunk of chunks ) collision.push( ...chunk ); return true; }, dropBand() {}
		} } );
		const geometry = new THREE.BufferGeometry().setAttribute( 'position', new THREE.Float32BufferAttribute( collision, 3 ) );
		for ( const surface of [ stream.group, new THREE.Mesh( geometry, material ) ] ) {

			expect( ray( surface, 0, 0 ) ).toHaveLength( 0 );
			expect( ray( surface, 5, 5 )[ 0 ].point.y ).toBeCloseTo( 0.2 );

		}
		stream.dispose();

	} );

} );
