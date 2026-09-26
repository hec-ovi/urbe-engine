import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { floorAssignments } from './FloorPrograms.js';

/** The programmes Interior's request accepts today. */
const ACCEPTED = JSON.parse( readFileSync( new URL( '../../../interior/schemas/request.schema.json', import.meta.url ), 'utf8' ) )
	.properties.assignments.items.properties.kind.enum;

/** A shared business plan: every storey reads the class it was drawn for. */
function plan( floors, { basements = 0, kind = 'commerce' } = {} ) {

	return { floors: Array.from( { length: basements + floors }, ( _, n ) => ( { index: n - basements, kind } ) ) };

}

const kinds = ( parcel, blueprint ) => floorAssignments( parcel, blueprint ).map( ( { kind } ) => kind );

describe( 'the programme each storey is furnished for', () => {

	it( 'furnishes a building for its parcel, not for the class its shared plan was drawn for', () => {

		const nine = plan( 9 );

		expect( kinds( { type: 'hotel', tier: 'mid' }, nine ) ).toEqual( [ 'lobby', ...Array( 8 ).fill( 'hotel_rooms' ) ] );
		expect( kinds( { type: 'residential', tier: 'mid' }, nine ) ).toEqual( [ 'lobby', ...Array( 8 ).fill( 'apartment' ) ] );
		expect( kinds( { type: 'residential', tier: 'poor' }, plan( 3, { kind: 'residential' } ) ) )
			.toEqual( [ 'lobby', 'residence_studio', 'residence_studio' ] );
		expect( kinds( { type: 'corpo', tier: 'high_rich' }, plan( 3 ) ) ).toEqual( [ 'lobby', 'corpo_office', 'corpo_office' ] );
		expect( kinds( { type: 'factory', tier: 'poor' }, plan( 2 ) ) ).toEqual( [ 'mechanical', 'mechanical' ] );
		// Institutions stand offices until Interior publishes their own programmes.
		for ( const type of [ 'hospital', 'clinic', 'police', 'military' ] ) {

			expect( kinds( { type, tier: 'rich' }, plan( 3 ) ) ).toEqual( [ 'lobby', 'office', 'office' ] );

		}

	} );

	it( 'opens a street venue on the ground floor alone, with homes or offices above it', () => {

		expect( kinds( { type: 'coffee_shop', tier: 'rich' }, plan( 24 ) ) ).toEqual( [ 'coffee_shop', ...Array( 23 ).fill( 'office' ) ] );
		expect( kinds( { type: 'restaurant', tier: 'mid' }, plan( 4 ) ) ).toEqual( [ 'restaurant', 'apartment', 'apartment', 'apartment' ] );
		expect( kinds( { type: 'commerce', tier: 'poor' }, plan( 2 ) ) ).toEqual( [ 'retail', 'residence_studio' ] );
		// A mall is a venue on every floor.
		expect( kinds( { type: 'mall', tier: 'rich' }, plan( 3 ) ) ).toEqual( Array( 3 ).fill( 'mall_floor' ) );

	} );

	it( 'assigns every floor a generated shell publishes, in names Interior accepts', () => {

		// Basements park, the lowest storey above them is the street, and a
		// hotel's crowning bar stays a bar.
		const hotel = plan( 12, { basements: 2, kind: 'hotel' } );
		hotel.floors.at( - 1 ).kind = 'bar';
		const assigned = floorAssignments( { type: 'hotel', tier: 'rich' }, hotel );

		expect( assigned.map( ( { floor } ) => floor ) ).toEqual( hotel.floors.map( ( { index } ) => index ) );
		expect( assigned.map( ( { kind } ) => kind ) )
			.toEqual( [ 'parking', 'parking', 'lobby', ...Array( 10 ).fill( 'hotel_rooms' ), 'restaurant' ] );

		const types = [ 'residential', 'hotel', 'offices', 'corpo', 'hospital', 'clinic', 'police', 'military',
			'factory', 'commerce', 'mall', 'restaurant', 'coffee_shop' ];

		for ( const type of types ) for ( const tier of [ 'poor', 'mid', 'rich', 'high_rich' ] ) {

			for ( const { kind } of floorAssignments( { type, tier }, hotel ) ) expect( ACCEPTED ).toContain( kind );

		}

	} );

} );
