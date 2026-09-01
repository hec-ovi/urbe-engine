import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { garments } from './Garments.js';

/**
 * The garment map is what puts clothes on a bare base body, so what it has to
 * get right is the body plan: the head and the hands stay skin, the chest and
 * the legs take cloth, the feet take shoes, and a limb parameter never leaks
 * onto a vertex that is not on that limb.
 */
describe( 'garments', () => {

	it( 'reads the body part from the bones a vertex hangs off', () => {

		const cloth = garments( bodyOf( [
			[ 'Head', 1 ],
			[ 'spine_02', 1 ],
			[ 'upperarm_l', 1 ],
			[ 'hand_r', 1 ],
			[ 'index_04_leaf_r', 1 ],
			[ 'thigh_l', 1 ],
			[ 'ball_leaf_r', 1 ]
		] ) );

		const at = ( i ) => [ cloth.getX( i ), cloth.getY( i ), cloth.getZ( i ), cloth.getW( i ) ];

		// head: no torso, on no limb, no shoe
		expect( at( 0 ) ).toEqual( [ 0, 2, 2, 0 ] );
		// chest: all torso
		expect( at( 1 ) ).toEqual( [ 1, 2, 2, 0 ] );
		// upper arm, then the hand and a fingertip further along the same arm
		expect( at( 2 )[ 1 ] ).toBeCloseTo( 0.28 );
		expect( at( 3 )[ 1 ] ).toBeCloseTo( 0.9 );
		expect( at( 4 )[ 1 ] ).toBeCloseTo( 1 );
		// thigh is a third of the way down the leg; a toe is the end of it and a shoe
		expect( at( 5 )[ 2 ] ).toBeCloseTo( 0.32 );
		expect( at( 6 )[ 2 ] ).toBeCloseTo( 1 );
		expect( at( 6 )[ 3 ] ).toBe( 1 );

	} );

	it( 'blends a vertex shared by two bones along the limb between them', () => {

		const cloth = garments( bodyOf( [ [ 'lowerarm_l', 0.5, 'hand_l', 0.5 ] ] ) );

		// halfway between the forearm at 0.66 and the hand at 0.9
		expect( cloth.getY( 0 ) ).toBeCloseTo( 0.78 );

	} );

	it( 'refuses a body with no skin attributes', () => {

		const mesh = { geometry: new THREE.BufferGeometry(), skeleton: { bones: [] } };

		expect( () => garments( mesh ) ).toThrow( /not skinned/ );

	} );

} );

/**
 * One vertex per row, each row naming the bones that drive it and their
 * weights. The skeleton is every bone any row mentions.
 */
function bodyOf( rows ) {

	const names = [ ...new Set( rows.flatMap( ( row ) => row.filter( ( _, i ) => i % 2 === 0 ) ) ) ];
	const index = new Uint16Array( rows.length * 4 );
	const weight = new Float32Array( rows.length * 4 );

	rows.forEach( ( row, vertex ) => {

		for ( let pair = 0; pair * 2 < row.length; pair ++ ) {

			index[ vertex * 4 + pair ] = names.indexOf( row[ pair * 2 ] );
			weight[ vertex * 4 + pair ] = row[ pair * 2 + 1 ];

		}

	} );

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'skinIndex', new THREE.BufferAttribute( index, 4 ) );
	geometry.setAttribute( 'skinWeight', new THREE.BufferAttribute( weight, 4 ) );

	return { geometry, skeleton: { bones: names.map( ( name ) => ( { name } ) ) } };

}
