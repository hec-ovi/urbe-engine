import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { StreetBodies } from './StreetBodies.js';

const body = ( id, x, z ) => ( { id, position: new THREE.Vector3( x, 0, z ) } );

describe( 'the street grid', () => {

	it( 'finds exactly the bodies inside a circle, across cells and on both sides of the origin', () => {

		const street = new StreetBodies();
		const bodies = [
			body( 'a', 0.5, 0.5 ), body( 'b', - 0.5, - 0.5 ), body( 'c', - 3.9, 2.1 ), body( 'd', 4.1, - 0.1 ),
			body( 'e', - 1999.2, 1500.7 ), body( 'f', 9.9, 9.9 ), body( 'g', - 2.01, - 2.01 )
		];
		street.open();
		for ( const one of bodies ) street.place( one );

		const near = ( x, z, radius ) => {

			const found = [];
			street.forEachNear( new THREE.Vector3( x, 0, z ), radius, ( one, distance ) => found.push( [ one.id, +distance.toFixed( 3 ) ] ) );
			return found.sort();

		};
		const brute = ( x, z, radius ) => bodies
			.map( ( one ) => [ one.id, Math.hypot( one.position.x - x, one.position.z - z ) ] )
			.filter( ( [ , distance ] ) => distance <= radius )
			.map( ( [ id, distance ] ) => [ id, +distance.toFixed( 3 ) ] )
			.sort();

		for ( const [ x, z, radius ] of [ [ 0, 0, 1 ], [ 0, 0, 4.5 ], [ - 1, 1, 3.5 ], [ 5, 5, 7.2 ], [ - 1999, 1500, 1 ], [ 0, 0, 0.1 ] ] ) {

			expect( near( x, z, radius ) ).toEqual( brute( x, z, radius ) );

		}
		expect( near( - 1999, 1500, 1 ).map( ( [ id ] ) => id ) ).toEqual( [ 'e' ] );

		// A new frame starts from an empty grid.
		street.open();
		expect( near( 0, 0, 50 ) ).toEqual( [] );

	} );

} );
