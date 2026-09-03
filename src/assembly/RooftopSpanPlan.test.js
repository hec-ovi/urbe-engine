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

	it( 'calls the public rooftop fitter and preserves its canonical result', async () => {

		const result = await runRooftopSpans( FIXTURE );
		const pairs = result.spans.map( ( span ) => [ span.a.buildingId, span.b.buildingId ] );

		expect( pairs ).toEqual( [ [ 'p135', 'p136' ], [ 'p71', 'p76' ] ] );
		expect( sha256( JSON.stringify( result ) ) ).toBe( '32c7c2634de7f0ae47d9c5f360e18de176e9be279d46ea55c334325fc5f17333' );

	} );

} );

function json( url ) {

	return JSON.parse( readFileSync( url, 'utf8' ) );

}

function sha256( value ) {

	return createHash( 'sha256' ).update( value ).digest( 'hex' );

}
