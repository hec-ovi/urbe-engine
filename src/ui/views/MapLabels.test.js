import { describe, expect, it } from 'vitest';
import { placeLabels } from './MapLabels.js';

/** A top-down view: one metre a pixel, the city's corner at the screen's. */
const flat = ( [ x, z ] ) => ( { x, y: z } );
const measure = ( text ) => text.length * 7;
const size = { width: 400, height: 300 };

describe( 'MapLabels', () => {

	it( 'names each street once along each stretch in view, upright, the longest first, never over another', () => {

		const streets = [
			{ name: 'First Street', paths: [ [ [ - 100, 100 ], [ 200, 100 ] ], [ [ 200, 100 ], [ 600, 100 ] ] ] },
			{ name: 'Second Street', paths: [ [ [ 600, 104 ], [ - 100, 104 ] ] ] },
			{ name: 'First Avenue', paths: [ [ [ 300, 400 ], [ 300, - 50 ] ] ] },
			{ name: 'Short Lane', paths: [ [ [ 50, 250 ], [ 90, 250 ] ] ] }
		];
		const labels = placeLabels( { mode: 'street', streets, project: flat, measure, size } );
		expect( labels.map( ( label ) => label.text ) ).toEqual( [ 'First Street', 'First Avenue' ] );
		const [ street, avenue ] = labels;
		// The edges of First Street join into one stretch across the view, named at its middle.
		expect( street.angle ).toBe( 0 );
		expect( street.x ).toBeCloseTo( 200 );
		expect( street.y ).toBeCloseTo( 100 );
		// An avenue drawn from south to north still reads upright.
		expect( avenue.angle ).toBeCloseTo( Math.PI / 2 );
		expect( avenue.x ).toBeCloseTo( 300 );

	} );

	it( 'leaves out a stretch behind the camera, and names a street again on each side of it', () => {

		const behind = ( [ x, z ] ) => x > 150 && x < 250 ? null : { x, y: z };
		const streets = [ { name: 'Long Street', paths: [ [ [ 0, 150 ], [ 400, 150 ] ] ] } ];
		const labels = placeLabels( { mode: 'street', streets, project: behind, measure, size } );
		expect( labels ).toHaveLength( 2 );
		expect( labels.every( ( label ) => label.x < 150 || label.x > 250 ) ).toBe( true );

	} );

	it( 'names the districts over their centres further out, in view and apart', () => {

		const districts = [
			{ name: 'downtown · rich', center: [ 100, 100 ] },
			{ name: 'docks · poor', center: [ 110, 104 ] },
			{ name: 'uptown · rich', center: [ 300, 220 ] },
			{ name: 'outskirts', center: [ 900, 900 ] }
		];
		const labels = placeLabels( { mode: 'district', districts, project: flat, measure, size } );
		expect( labels.map( ( label ) => label.text ) ).toEqual( [ 'downtown · rich', 'uptown · rich' ] );
		expect( labels[ 0 ] ).toMatchObject( { kind: 'district', x: 100, y: 100, angle: 0 } );

	} );

} );
