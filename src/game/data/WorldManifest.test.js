import { describe, expect, it } from 'vitest';
import { worldManifestErrors } from './WorldManifest.js';

const manifest = {
	contractVersion: '1.0.0', seed: 'city', atlasVersion: '0.14.0', named: false, namingTheme: null,
	parcels: [ 'p0', 'p1' ], interiors: [ 'p1' ], floors: { p1: [ '000', '001' ] }
};

describe( 'world manifest boundary', () => {

	it( 'accepts explicit shell and interior sets', () => {

		expect( worldManifestErrors( manifest, new Set( [ 'p0', 'p1' ] ) ) ).toEqual( [] );

	} );

	it( 'fails closed when interiors, floors and blueprint parcels disagree', () => {

		const invalid = { ...manifest, parcels: [ 'p0' ], interiors: [ 'p1' ], floors: { p0: [ 'zero' ] } };
		const errors = worldManifestErrors( invalid, new Set( [ 'p0' ] ) );

		expect( errors ).toContain( 'interior p1 has no shell parcel' );
		expect( errors ).toContain( 'interior p1 lists no floors' );
		expect( errors ).toContain( 'floors.p0 is not an interior' );
		expect( errors ).toContain( 'floors.p0 must contain floor tags' );

	} );

} );
