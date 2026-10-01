import { describe, expect, it } from 'vitest';
import { INDOOR_RADIUS, IndoorSteer } from './IndoorSteer.js';

const FRAME = 0.1;
const PACE = 1.2;

/**
 * Walkers along the Z axis of a corridor: each walks its own straight way at
 * PACE, as far as the steer lets it, until it gets there. Returns the drawn
 * positions frame by frame and when each got there.
 */
function run( steer, walkers, { frames = 600, player = null } = {} ) {

	const drawn = [], arrived = new Map();
	for ( let frame = 0; frame < frames && arrived.size < walkers.length; frame ++ ) {

		const bodies = walkers.map( ( w ) => ( {
			id: w.id, parcelId: 'p1', position: [ w.x, 0, w.z ], heading: w.to > w.from ? 0 : Math.PI,
			moving: ! arrived.has( w.id ), priority: w.priority ?? 0
		} ) );
		steer.update( bodies, player, FRAME );
		for ( const w of walkers ) {

			if ( arrived.has( w.id ) ) continue;
			const sign = Math.sign( w.to - w.from ), given = steer.travel( w.id, PACE * FRAME );
			w.z += sign * given;
			if ( ( w.z - w.to ) * sign >= 0 ) { w.z = w.to; arrived.set( w.id, frame ); }

		}
		drawn.push( walkers.map( ( w ) => {

			const heading = w.to > w.from ? 0 : Math.PI, offset = steer.offset( w.id );
			return [ w.x + Math.cos( heading ) * offset, w.z - Math.sin( heading ) * offset ];

		} ) );

	}
	return { drawn, arrived };

}

const closest = ( drawn ) => Math.min( ...drawn.map( ( [ a, b ] ) => Math.hypot( a[ 0 ] - b[ 0 ], a[ 1 ] - b[ 1 ] ) ) );

describe( 'people giving way inside buildings', () => {

	it( 'steps two people meeting in a corridor to their own right, so they pass without touching', () => {

		// A 2.4 m corridor along Z, its middle at x 0.
		const steer = new IndoorSteer( { walkable: ( id, [ x ] ) => Math.abs( x ) <= 1.2 } );
		const walkers = [ { id: 'a', x: 0, z: 0, from: 0, to: 12 }, { id: 'b', x: 0, z: 12, from: 12, to: 0 } ];
		const { drawn, arrived } = run( steer, walkers );
		expect( arrived.size ).toBe( 2 );
		expect( closest( drawn ) ).toBeGreaterThanOrEqual( INDOOR_RADIUS * 2 - 0.05 );
		// Each kept to its own right: a walks +Z, its right is -X; b walks -Z, its right is +X.
		const meeting = drawn[ drawn.findIndex( ( [ a, b ] ) => Math.abs( a[ 1 ] - b[ 1 ] ) < 0.3 ) ];
		expect( meeting[ 0 ][ 0 ] ).toBeLessThan( 0 );
		expect( meeting[ 1 ][ 0 ] ).toBeGreaterThan( 0 );
		// And both are back on their line once past.
		expect( steer.offset( 'a' ) ).toBeCloseTo( 0, 1 );

	} );

	it( 'in a corridor too narrow to pass, lets the first go while the other steps back into a wider stretch and waits', () => {

		// One body wide (0.9 m) everywhere but an alcove 2.4 m wide between z 9 and 11.
		const walkable = ( id, [ x, , z ] ) => Math.abs( x ) <= ( z >= 9 && z <= 11 ? 1.2 : 0.45 );
		const steer = new IndoorSteer( { walkable } );
		const walkers = [ { id: 'a', x: 0, z: 0, from: 0, to: 14 }, { id: 'b', x: 0, z: 13, from: 13, to: 0 } ];
		const { drawn, arrived } = run( steer, walkers, { frames: 900 } );
		expect( arrived.size ).toBe( 2 );
		expect( arrived.get( 'a' ) ).toBeLessThan( arrived.get( 'b' ) );
		expect( closest( drawn ) ).toBeGreaterThanOrEqual( INDOOR_RADIUS * 2 - 0.1 );

	} );

	it( 'gives way to a higher priority even when its id comes later, and never both at once', () => {

		const steer = new IndoorSteer( { walkable: ( id, [ x ] ) => Math.abs( x ) <= 0.45 } );
		const walkers = [ { id: 'a', x: 0, z: 0, from: 0, to: 6, priority: 0 }, { id: 'z', x: 0, z: 6, from: 6, to: 0, priority: 2 } ];
		const bodies = () => walkers.map( ( w ) => ( { id: w.id, parcelId: 'p1', position: [ w.x, 0, w.z ], heading: w.to > w.from ? 0 : Math.PI, moving: true, priority: w.priority } ) );
		walkers[ 0 ].z = 2.4; walkers[ 1 ].z = 3.4;
		steer.update( bodies(), null, FRAME );
		expect( steer.holds( 'a' ) ).toBe( true );
		expect( steer.holds( 'z' ) ).toBe( false );
		steer.update( bodies(), null, FRAME );
		expect( steer.holds( 'z' ) ).toBe( false );

	} );

	it( 'walks around the player standing in its way, or waits for them where it cannot, and never forever', () => {

		const wide = new IndoorSteer( { walkable: ( id, [ x ] ) => Math.abs( x ) <= 1.2 } );
		const around = run( wide, [ { id: 'a', x: 0, z: 0, from: 0, to: 8 } ], { player: [ 0, 0, 4 ] } );
		expect( around.arrived.size ).toBe( 1 );
		expect( Math.min( ...around.drawn.map( ( [ a ] ) => Math.hypot( a[ 0 ], a[ 1 ] - 4 ) ) ) ).toBeGreaterThanOrEqual( INDOOR_RADIUS * 2 - 0.05 );

		const narrow = new IndoorSteer( { walkable: ( id, [ x ] ) => Math.abs( x ) <= 0.3 } );
		const walker = { id: 'a', x: 0, z: 0, from: 0, to: 8 };
		const held = run( narrow, [ walker ], { player: [ 0, 0, 4 ], frames: 30 } );
		expect( held.arrived.size ).toBe( 0 );
		expect( walker.z ).toBeLessThan( 4 - INDOOR_RADIUS * 2 + 0.05 );
		// The player stays: after its patience the walker goes on past them rather than stand there for ever.
		const later = run( narrow, [ walker ], { player: [ 0, 0, 4 ], frames: 200 } );
		expect( later.arrived.size ).toBe( 1 );

	} );

	it( 'follows somebody going its way at arm\'s length instead of walking into their back', () => {

		const steer = new IndoorSteer( { walkable: ( id, [ x ] ) => Math.abs( x ) <= 0.45 } );
		const bodies = ( a, b ) => [ { id: 'a', parcelId: 'p1', position: [ 0, 0, a ], heading: 0, moving: true, priority: 0 },
			{ id: 'b', parcelId: 'p1', position: [ 0, 0, b ], heading: 0, moving: true, priority: 0 } ];
		steer.update( bodies( 0, 0.75 ), null, FRAME );
		expect( steer.travel( 'a', 0.12 ) ).toBe( 0 );
		expect( steer.travel( 'b', 0.12 ) ).toBe( 0.12 );
		steer.update( bodies( 0, 2 ), null, FRAME );
		expect( steer.travel( 'a', 0.12 ) ).toBe( 0.12 );

	} );

	it( 'leaves people on other floors and standing people to themselves', () => {

		const steer = new IndoorSteer( { walkable: ( id, [ x ] ) => Math.abs( x ) <= 0.45 } );
		steer.update( [ { id: 'a', parcelId: 'p1', position: [ 0, 0, 0 ], heading: 0, moving: true, priority: 0 },
			{ id: 'b', parcelId: 'p1', position: [ 0, 4, 1 ], heading: Math.PI, moving: true, priority: 9 },
			{ id: 'c', parcelId: 'p1', position: [ 0, 0, 5 ], heading: Math.PI, moving: false, priority: 9 } ], null, FRAME );
		expect( steer.travel( 'a', 0.12 ) ).toBe( 0.12 );
		expect( steer.travel( 'c', 0.12 ) ).toBe( 0.12 );

	} );

} );
