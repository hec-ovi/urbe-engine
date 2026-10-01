import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { daylightSpread, facadeLight, glazingOf, planSamples, roomDaylight } from './RoomDaylight.js';
import { roomsOf } from '../city/InteriorRooms.js';

/** A 20 by 20 m storey wound as the exterior box winds its outlines, one 4 by 2 m window on its south face. */
function blueprint( { openings = null, closure = 0 } = {} ) {

	return {
		facade: { wallDepth: 0.6 },
		floors: [ {
			index: 0,
			outline: [ [ 0, 0 ], [ 20, 0 ], [ 20, 20 ], [ 0, 20 ] ],
			openings: openings ?? [
				{ kind: 'window', edge: 0, offset: 8, width: 4, sill: 1, height: 2, ...( closure ? { curtain: { style: 'roller-shade', closurePercent: closure } } : {} ) },
				{ kind: 'door', edge: 1, offset: 8, width: 2, sill: 0, height: 2.5 }
			]
		} ]
	};

}

/** Noon over the city: the sun high in the south (-z), the sky at full daylight. */
const noon = { daylight: 1, sunLux: 100000, skyLuminance: 9000, direction: new THREE.Vector3( 0, 0.77, - 0.64 ).normalize() };
const night = { daylight: 0, sunLux: 0, skyLuminance: 0, direction: new THREE.Vector3( 0, 1, 0 ) };

describe( 'room daylight', () => {

	it( 'takes a storey\'s glazed openings as points of glass just inside its walls, facing out', () => {

		const [ window, ...rest ] = glazingOf( blueprint(), 0 );

		expect( rest ).toHaveLength( 0 );
		expect( window.outward.map( ( value ) => value + 0 ) ).toEqual( [ 0, - 1 ] );
		expect( window.area ).toBe( 8 );
		expect( window.head ).toBe( 3 );
		expect( window.points ).toHaveLength( 4 );
		expect( window.points.every( ( point ) => point.z > 0.6 && point.z < 1.5 && point.x > 8 && point.x < 12 ) ).toBe( true );
		expect( window.points.reduce( ( sum, point ) => sum + point.area, 0 ) ).toBeCloseTo( 8 );

		// Wound the other way round, the outside is still outside.
		const turned = blueprint();
		turned.floors[ 0 ].outline = [ [ 0, 0 ], [ 0, 20 ], [ 20, 20 ], [ 20, 0 ] ];
		turned.floors[ 0 ].openings[ 0 ].edge = 3;
		expect( glazingOf( turned, 0 )[ 0 ].outward.map( ( value ) => value + 0 ) ).toEqual( [ 0, - 1 ] );

		// A drawn blind lets a fifth through; a storey with no glass lets nothing.
		expect( glazingOf( blueprint( { closure: 100 } ), 0 )[ 0 ].area ).toBeCloseTo( 8 * 0.2 );
		expect( glazingOf( blueprint( { openings: [] } ), 0 ) ).toEqual( [] );
		expect( glazingOf( blueprint(), 3 ) ).toEqual( [] );
		expect( glazingOf( null, 0 ) ).toEqual( [] );

	} );

	it( 'lights glass with the sky it faces, the sun only when turned to it, and the street from below', () => {

		const south = facadeLight( [ 0, - 1 ], noon );
		const north = facadeLight( [ 0, 1 ], noon );

		expect( south.sky ).toBeCloseTo( Math.PI * 9000 * 0.5 / 2 );
		expect( north.sky ).toBeCloseTo( south.sky );
		expect( south.sun ).toBeGreaterThan( 20000 );
		expect( north.sun ).toBe( 0 );
		expect( south.ground ).toBeGreaterThan( 0 );
		expect( facadeLight( [ 0, - 1 ], night ) ).toEqual( { sky: 0, sun: 0, ground: 0 } );

	} );

	it( 'gives a room the flux through the glass at its walls, down from the sky and the sun, up from the street', () => {

		const windows = glazingOf( blueprint(), 0 );
		const inside = ( x, z ) => x >= 0.6 && x <= 19.4 && z >= 0.6 && z <= 10;
		const day = roomDaylight( inside, windows, noon );
		const light = facadeLight( [ 0, - 1 ], noon );

		expect( day.down ).toBeCloseTo( 8 * 0.6 * ( light.sky + light.sun ), 0 );
		expect( day.up ).toBeCloseTo( 8 * 0.6 * light.ground, 0 );
		// The sky's light is bluer than the sun's.
		expect( day.downColor.b ).toBeGreaterThan( day.upColor.b );
		expect( day.sources.reduce( ( sum, source ) => sum + source.share, 0 ) ).toBeCloseTo( 1 );

		// The room across the storey has no glass of its own, and night brings nothing.
		expect( roomDaylight( ( x, z ) => z > 10, windows, noon ) ).toBeNull();
		expect( roomDaylight( inside, windows, night ) ).toBeNull();

	} );

	it( 'lands the day near the glass, the room as a whole taking exactly what came in', () => {

		const bounds = { x0: 0.6, z0: 0.6, x1: 19.4, z1: 10 };
		const inside = ( x, z ) => x >= bounds.x0 && x <= bounds.x1 && z >= bounds.z0 && z <= bounds.z1;
		const day = roomDaylight( inside, glazingOf( blueprint(), 0 ), noon );
		const plan = planSamples( bounds, 176, inside );
		const spread = daylightSpread( day.sources, plan );

		const mean = plan.reduce( ( sum, [ x, z ] ) => sum + spread( x, z ), 0 ) / plan.length;
		expect( mean ).toBeGreaterThan( 0.8 );
		expect( mean ).toBeLessThanOrEqual( 1 + 1e-9 );
		expect( spread( 10, 1.5 ) ).toBeGreaterThan( 2 * spread( 10, 9 ) );
		expect( spread( 10, 1.5 ) ).toBeGreaterThan( spread( 2, 1.5 ) );

	} );

	it( 'brightens a glazed room by day near its glass, closes the eye down for it, and leaves the night alone', () => {

		const floor = {
			id: 'b:0', parcelId: 'b', floor: 0, elevation: 0, height: 3,
			rooms: [ { id: 'front', polygon: [ [ 0.6, 0.6 ], [ 19.4, 0.6 ], [ 19.4, 10 ], [ 0.6, 10 ] ] } ],
			lights: [ { room: 'front', kind: 'spot', position: [ 10, 2.9, 5 ], intensity: 6000, colorTemperatureK: 3000, range: 3, beamDeg: 100, facing: 'down' } ],
			placements: []
		};
		const catalog = { boundsOf: () => null, slotsOf: () => [] };
		const windows = glazingOf( blueprint(), 0 );
		const [ dark ] = roomsOf( floor, catalog );
		const [ lit ] = roomsOf( floor, catalog, null, { windows, sky: noon } );
		const [ moonlit ] = roomsOf( floor, catalog, null, { windows, sky: night } );

		expect( moonlit.daylit ).toBeNull();
		expect( moonlit.fill.toArray() ).toEqual( dark.fill.toArray() );
		expect( moonlit.dayStops ).toBe( 0 );

		expect( lit.fill.x ).toBeGreaterThan( 5 * dark.fill.x );
		const byGlass = lit.fillAt( 10, 1.5 );
		const atBack = lit.fillAt( 10, 9.5 );
		expect( byGlass.x ).toBeGreaterThan( 2 * atBack.x );
		// The ceiling by the glass takes the street's glow as well as the bounce.
		expect( byGlass.x * byGlass.w ).toBeGreaterThan( atBack.x * atBack.w );
		// Graded down to read as a bright room: its mean light over 400 lux, in stops.
		const mean = ( 0.2126 * lit.fill.x + 0.7152 * lit.fill.y + 0.0722 * lit.fill.z ) * ( 1 + lit.fill.w ) / 2;
		expect( lit.dayStops ).toBeCloseTo( - Math.log2( mean / 400 ), 6 );
		expect( lit.dayStops ).toBeLessThan( 0 );

	} );

} );
