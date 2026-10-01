import { describe, expect, it } from 'vitest';
import { appearance } from './Appearance.js';
import { BUILD_LEVELS, BUILD_STEP, ROW_SPAN, packLook } from './CrowdLook.js';
import { characterParts, crowdBuilds } from './CharacterAssets.js';
import { BUILD_KEYS } from './avatar/Recipe.js';
import { BodyShapes } from './avatar/BodyShape.js';
import { whole } from './avatar/Steps.js';
import { SOURCE_PRESENT, sourceGltf } from './avatar/SourceAssets.test-fixtures.js';

/** What the crowd's vertex stage reads back of a pose lane: its row and the person's builds (CrowdLook.buildNode). */
function decode( lane ) {

	const code = Math.floor( lane / ROW_SPAN );
	const middle = ( BUILD_LEVELS - 1 ) / 2;
	return {
		row: lane % ROW_SPAN,
		upper: ( ( code % 16 ) - middle ) * BUILD_STEP,
		waist: ( ( Math.floor( code / 16 ) % 16 ) - middle ) * BUILD_STEP,
		lower: ( Math.floor( code / 256 ) - middle ) * BUILD_STEP
	};

}

describe( 'the crowd\'s builds', () => {

	it( 'carries each person\'s three builds above their row, to within half a step, the neutral body exactly', () => {

		for ( let seed = 0; seed < 300; seed ++ ) {

			const look = appearance( { gender: seed % 2 ? 'male' : 'female', appearanceSeed: seed * 2654435761 >>> 0 } );
			const row = seed % 316;
			// The lane is a float: every value it carries is a whole number well inside 2^24.
			const lane = row + packLook( look ).builds * ROW_SPAN;
			expect( lane ).toBeLessThan( 2 ** 24 );
			const read = decode( lane );
			expect( read.row ).toBe( row );
			for ( const build of Object.keys( BUILD_KEYS ) ) expect( Math.abs( read[ build ] - look.builds[ build ] ) ).toBeLessThanOrEqual( BUILD_STEP / 2 + 1e-9 );

		}
		const neutral = decode( packLook( { ...appearance( { gender: 'male', appearanceSeed: 1 } ), builds: { upper: 0, waist: 0, lower: 0 } } ).builds * ROW_SPAN );
		expect( [ neutral.upper, neutral.waist, neutral.lower ] ).toEqual( [ 0, 0, 0 ] );

	} );

	it( 'lays each build\'s controls on the rest normal of every vertex, and leaves the eyes after the body alone', () => {

		const shapes = {
			normals: new Float32Array( [ 0, 0, 1, 2, 0, 0 ] ),
			basis: Object.fromEntries( Object.values( BUILD_KEYS ).flat().map( ( key ) => [ key, new Float32Array( 6 ) ] ) )
		};
		shapes.basis.build.set( [ 0, 0.1, 0.2, 0.3, 0, 0 ] );
		shapes.basis.chest.set( [ 0.5, 0, 0.1, 0, 0, 0 ] );
		shapes.basis.waist.set( [ 0, 0, 0, - 0.2, 0.4, 0 ] );
		shapes.basis.thighs.set( [ 0, 0, 0.05, 0, 0, 0 ] );
		const builds = crowdBuilds( shapes, 3 );
		// Only what runs along the normal counts, and an unnormalised normal is taken as its direction.
		expect( Array.from( builds ).map( ( value ) => Math.round( value * 1000 ) / 1000 ) ).toEqual( [ 0.3, 0, 0.05, 0, 0.3, - 0.2, 0, 0, 0, 0, 0, 0 ] );

	} );

	it.skipIf( ! SOURCE_PRESENT )( 'widens the real body\'s torso, waist and hips where its shape controls do', async () => {

		const gltf = await sourceGltf( 'Regular_Male_FullBody.gltf' );
		const { body, eyes } = characterParts( gltf.scene );
		const count = body.geometry.getAttribute( 'position' ).count;
		const builds = crowdBuilds( whole( BodyShapes.measure( gltf.scene ) ), count + eyes.geometry.getAttribute( 'position' ).count );
		const lane = ( index ) => Array.from( { length: count }, ( _, vertex ) => builds[ vertex * 4 + index ] );
		for ( const index of [ 0, 1, 2 ] ) expect( Math.max( ...lane( index ).map( Math.abs ) ) ).toBeGreaterThan( 0.03 );
		// Mostly outward: a wider build pushes the surface out, not in.
		expect( lane( 0 ).filter( ( value ) => value > 0.005 ).length ).toBeGreaterThan( lane( 0 ).filter( ( value ) => value < - 0.005 ).length * 4 );
		expect( Array.from( builds.subarray( count * 4 ) ).every( ( value ) => value === 0 ) ).toBe( true );

	} );

} );
