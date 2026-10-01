import { describe, expect, it } from 'vitest';
import { Passage } from './Passage.js';

const point = ( x, y, z ) => ( { x, y, z } );

describe( 'Passage', () => {

	it( "asks the door a walker's gate names open, marks it asked so it stays open while walkers keep asking, and lets the walker through once it is open", () => {

		const front = { parcelId: 'p1', center: point( 10, 0, 5 ), open: 0, wanted: 0 };
		const upstairs = { parcelId: 'p1', center: point( 10, 4.5, 5 ), open: 0, wanted: 0 };
		const passage = new Passage( { doors: () => [ front, upstairs, { parcelId: 'p2', center: point( 10, 0, 5 ), open: 0, wanted: 0 } ] } );
		const gate = { kind: 'door', parcelId: 'p1', at: 3, position: [ 10.4, 0, 5.2 ] };
		expect( passage.pass( 'n1', gate ) ).toBe( false );
		expect( front ).toMatchObject( { wanted: 1, asked: true } );
		expect( upstairs.wanted ).toBe( 0 );
		front.open = 1;
		front.asked = false;
		expect( passage.pass( 'n1', gate ) ).toBe( true );
		expect( front.asked ).toBe( true );
		// A door nobody loaded is no bar to the walker.
		expect( passage.pass( 'n1', { ...gate, position: [ 40, 0, 5 ] } ) ).toBe( true );

	} );

	it( 'opens a host\'s own door on asking, the door left to close by itself like any other', () => {

		const home = { parcelId: 'p1', center: point( 10, 4.5, 5 ), open: 0, wanted: 0 };
		const passage = new Passage( { doors: () => [ home ] } );
		const gate = { kind: 'door', parcelId: 'p1', floor: 1, position: [ 10, 4.5, 5 ] };
		expect( passage.open( gate ) ).toBe( true );
		expect( home ).toMatchObject( { wanted: 1, asked: true } );
		expect( passage.open( { ...gate, position: [ 40, 4.5, 5 ] } ) ).toBe( false );

	} );

	it( "calls a lift to the walker's landing, boards it open, sends it to the walker's floor and lets the walker out when it opens there", () => {

		const stops = [ { floor: 0, elevation: 0, open: 0 }, { floor: 3, elevation: 13.5, open: 0 } ];
		const shaft = {
			liftId: 'elev-0', stops, at: 13.5, target: 13.5, called: false, selected: 1, pressed: [],
			get moving() { return Math.abs( this.target - this.at ) > 1e-3; },
			stopAt( floor ) { return stops.find( ( stop ) => stop.floor === floor ) ?? null; },
			press( target ) {

				this.pressed.push( target );
				const stop = target.inside ? stops[ this.selected ] : target.stop;
				this.target = stop.elevation;
				this.called = true;

			}
		};
		const passage = new Passage( { elevators: { byBuilding: new Map( [ [ 'p1', [ shaft ] ] ] ) } } );
		const gate = { kind: 'lift', parcelId: 'p1', shaft: 'elev-0', fromFloor: 0, toFloor: 3, from: 1, board: 2, alight: 15.5, to: 16.5 };
		expect( passage.ride( 'n1', gate, 'call' ) ).toBe( 'wait' );
		expect( passage.ride( 'n1', gate, 'call' ) ).toBe( 'wait' );
		expect( shaft.pressed ).toEqual( [ { inside: false, stop: stops[ 0 ] } ] );
		shaft.at = 0;
		stops[ 0 ].open = 1;
		expect( passage.ride( 'n1', gate, 'call' ) ).toBe( 'board' );
		expect( passage.ride( 'n1', gate, 'ride' ) ).toEqual( { y: 0 } );
		expect( shaft.pressed.at( - 1 ) ).toEqual( { inside: true } );
		expect( shaft.target ).toBe( 13.5 );
		shaft.at = 6;
		expect( passage.ride( 'n1', gate, 'ride' ) ).toEqual( { y: 6 } );
		shaft.at = 13.5;
		expect( passage.ride( 'n1', gate, 'ride' ) ).toEqual( { y: 13.5 } );
		stops[ 1 ].open = 1;
		expect( passage.ride( 'n1', gate, 'ride' ) ).toBe( 'alight' );
		expect( passage.ride( 'n1', gate, 'done' ) ).toBe( 'done' );
		expect( passage.ride( 'n1', { ...gate, shaft: 'elev-9' }, 'call' ) ).toBeNull();
		expect( new Passage().ride( 'n1', gate, 'call' ) ).toBeNull();

	} );

} );
