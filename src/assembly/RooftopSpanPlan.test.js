import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { rooftopSpanRequest } from './RooftopSpanPlan.js';
import { runRooftopSpans } from './connectionsRunner.js';

const CONNECTIONS = new URL( '../../../connections/', import.meta.url );
const FIXTURE = json( new URL( 'fixtures/rooftop-spans.request.json', CONNECTIONS ) );
const BLUEPRINTS = json( new URL( './rooftop-span-blueprints.fixture.json', import.meta.url ) );
const IDS = [ 'p135', 'p136', 'p71', 'p76', 'p111' ];

describe( 'rooftop span assembly boundary', () => {

	it( 'derives Connections complete fitting scene from final Exterior blueprints', () => {

		const buildings = IDS.map( ( buildingId ) => ( {
			buildingId,
			blueprint: BLUEPRINTS[ buildingId ]
		} ) );
		const request = rooftopSpanRequest(
			{ meta: { seed: 'urbe' } },
			buildings,
			{ seed: FIXTURE.seed, params: FIXTURE.params }
		);

		expect( request ).toEqual( FIXTURE );

	} );

	it( 'preserves canonical rooftop geometry and the source package version', async () => {

		const result = await runRooftopSpans( FIXTURE );
		const pairs = result.spans.map( ( span ) => [ span.a.buildingId, span.b.buildingId ] );
		const { generatorVersion, ...meta } = result.meta;

		expect( pairs ).toEqual( [ [ 'p135', 'p136' ], [ 'p71', 'p76' ] ] );
		expect( generatorVersion ).toBe( json( new URL( 'package.json', CONNECTIONS ) ).version );
		expect( sha256( JSON.stringify( { ...result, meta } ) ) ).toBe( 'daaf4e81d6e003fdcba2d1e52ff628e5c0fe94f38ca68b475ac18c4be34c46cc' );

	} );

} );

function json( url ) {

	return JSON.parse( readFileSync( url, 'utf8' ) );

}

function sha256( value ) {

	return createHash( 'sha256' ).update( value ).digest( 'hex' );

}
