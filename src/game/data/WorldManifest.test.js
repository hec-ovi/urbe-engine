import { describe, expect, it } from 'vitest';
import { worldManifestErrors } from './WorldManifest.js';

const manifest = {
	contractVersion: '1.0.0', seed: 'city', atlasVersion: '0.14.0', named: false, namingTheme: null,
	parcels: [ 'p0', 'p1' ], interiors: [ 'p1' ], floors: { p1: [ '000', '001' ] }
};
const rooftopSpan = {
	id: 'roof:p0:a--p1:b',
	a: { buildingId: 'p0', attachmentId: 'a', position: [ 0, 10, 0 ] },
	b: { buildingId: 'p1', attachmentId: 'b', position: [ 10, 10, 0 ] },
	catenary: {
		type: 'catenary', groundOrigin: [ 0, 0 ], horizontalDirection: [ 1, 0 ], horizontalDistance: 10,
		scale: 50, horizontalOffset: 5, verticalOffset: - 40, domain: [ 0, 10 ]
	},
	path: [ [ 0, 10, 0 ], [ 5, 9.9, 0 ], [ 10, 10, 0 ] ],
	thickness: 0.04, sag: 0.1, slack: 0.01, slackRatio: 1.001, length: 10.01
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

	it( 'accepts the Connections rooftop span document and rejects unknown endpoints', () => {

		const rooftopSpans = {
			meta: { seed: 'city:rooftop-spans', schemaVersion: '1.0.0', generatorVersion: '0.10.0' },
			spans: [ rooftopSpan ]
		};

		expect( worldManifestErrors( { ...manifest, rooftopSpans }, new Set( [ 'p0', 'p1' ] ) ) ).toEqual( [] );
		expect( worldManifestErrors( {
			...manifest,
			rooftopSpans: { ...rooftopSpans, spans: [ { ...rooftopSpan, b: { ...rooftopSpan.b, buildingId: 'p9' } } ] }
		}, new Set( [ 'p0', 'p1' ] ) ) ).toContain( 'rooftopSpans.spans[0].b.buildingId is not a shell parcel' );

	} );

} );
