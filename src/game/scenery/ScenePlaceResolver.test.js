import { beforeAll, describe, expect, it } from 'vitest';
import { generate, expandBuilding, makePlacementFixture } from '../../../../interior/src/index.ts';
import { buildingFloors } from '../city/InteriorLayouts.js';
import { ScenePlaceResolver } from './ScenePlaceResolver.js';
import { SceneryCompiler } from './SceneryCompiler.js';
import { rotate2 } from './StagingAssembler.js';

let interior;
let npc;

beforeAll( async () => {

	interior = await generate( makePlacementFixture( { width: 24, depth: 32, floors: 4, type: 'residential', tier: 'high_rich', seed: 11 } ) );
	npc = expandBuilding( interior ).npc;

}, 30000 );

function resolver( building = { interior, npc }, extra = {} ) {

	return new ScenePlaceResolver( { buildings: new Map( [ [ 'p1', building ] ] ), ...extra } );

}

function floorRooms( floor ) {

	return buildingFloors( 'p1', interior ).find( ( record ) => record.floor === floor );

}

describe( 'scene places', () => {

	it( 'stands a room frame inside the room the seed picks, on the floor the building draws it at', () => {

		const place = { kind: 'room', parcelId: 'p1', floor: 2, roomKinds: [ 'living', 'bedroom' ] };
		const first = resolver().resolve( place, 5 );
		expect( resolver().resolve( structuredClone( place ), 5 ) ).toEqual( first );
		const record = floorRooms( 2 );
		const room = record.rooms.find( ( candidate ) => candidate.id === first.place.roomId );
		expect( [ 'living', 'bedroom' ] ).toContain( room.kind );
		expect( first.place ).toEqual( { parcelId: 'p1', floor: 2, roomId: room.id } );

		const { location } = first;
		// Upper floors stand where InteriorStream draws their layout: at the building floor's elevation.
		expect( location.origin.y ).toBe( record.elevation );
		expect( location.origin.y ).toBeGreaterThan( 0 );
		expect( location.width ).toBeGreaterThanOrEqual( 3 );
		expect( location.depth ).toBeGreaterThanOrEqual( 3 );
		for ( const corner of corners( location ) ) expect( inside( room.polygon, corner ) ).toBe( true );
		expect( location.entries.map( ( entry ) => entry.entryId ) ).toEqual( [ ...new Set( room.doors.map( ( door ) => door.id ) ) ] );
		const layout = interior.layouts[ record.layout ].floor;
		const furniture = layout.furniture.filter( ( item ) => item.room === room.id ).map( ( item ) => item.id );
		expect( location.blockedZones.map( ( zone ) => zone.blockerId ).every( ( id ) => furniture.includes( id ) || id.startsWith( `${room.id}:hole:` ) ) ).toBe( true );
		expect( location.blockedZones.length ).toBeGreaterThan( 0 );

		const [ floor ] = location.receivingSurfaces;
		expect( cross( floor.uAxis, floor.vAxis ) ).toEqual( { x: 0, y: 1, z: 0 } );
		expect( floor.blockedRegions ).toHaveLength( location.blockedZones.length );

	} );

	it( 'turns a frame with a room that stands at an angle, keeping its measure', () => {

		const place = { kind: 'room', parcelId: 'p1', floor: 1, roomKinds: [ 'living' ] };
		const straight = resolver().resolve( place, 3 );
		const turn = Math.PI / 6;
		const turned = resolver( { interior: turnedInterior( turn ), npc } ).resolve( place, 3 );
		expect( turned.place ).toEqual( straight.place );
		expect( turned.location.yawRadians ).toBeCloseTo( turn, 5 );
		expect( turned.location.width ).toBeCloseTo( straight.location.width, 5 );
		expect( turned.location.depth ).toBeCloseTo( straight.location.depth, 5 );
		expect( turned.location.entries.map( ( entry ) => entry.position.x ) )
			.toEqual( straight.location.entries.map( ( entry ) => expect.closeTo( entry.position.x, 4 ) ) );
		const origin = rotate2( straight.location.origin, turn );
		expect( turned.location.origin.x ).toBeCloseTo( origin.x, 4 );
		expect( turned.location.origin.z ).toBeCloseTo( origin.z, 4 );

	} );

	it( 'puts a story slot scene in a room Interior reserved the slot in, the slot its anchor', () => {

		const place = { kind: 'story-slot', parcelId: 'p1', floor: 1, roomKinds: [ 'living', 'bedroom', 'kitchen' ] };
		const resolved = resolver().resolve( place, 9 );
		const slot = npc.placements.find( ( item ) => item.purpose === 'story' && item.room === `floor:1/${resolved.place.roomId}` );
		expect( slot ).toBeDefined();
		const local = rotate2( { x: slot.position[ 0 ] - resolved.location.origin.x, z: slot.position[ 1 ] - resolved.location.origin.z }, - resolved.location.yawRadians );
		expect( resolved.anchor.x ).toBeCloseTo( local.x, 5 );
		expect( resolved.anchor.z ).toBeCloseTo( local.z, 5 );
		expect( resolver().resolve( place, 9, resolved.place ) ).toEqual( resolved );

	} );

	it( 'opens a parcel entry scene in the ground room its main door leads into', () => {

		const room = floorRooms( 0 ).rooms.find( ( candidate ) => candidate.kind === 'reception' ) ?? floorRooms( 0 ).rooms[ 0 ];
		const [ x, z ] = room.polygon.reduce( ( [ sx, sz ], [ px, pz ] ) => [ sx + px / room.polygon.length, sz + pz / room.polygon.length ], [ 0, 0 ] );
		const doors = [ { id: 'entrance', parcelId: 'p1', inside: { x, y: 0, z } } ];
		const resolved = resolver( { interior, npc }, { doors } ).resolve( { kind: 'parcel-entry', parcelId: 'p1' }, 1 );
		expect( resolved.place ).toEqual( { parcelId: 'p1', floor: 0, roomId: room.id } );

	} );

	it( 'lays a street scene on the sidewalk in front of the access point, its back on the lot line and its fixtures blocked', () => {

		const door = { id: 'p5:main', parcelId: 'p5', inside: { x: 37.8, y: 0.2, z: 145.3 } };
		const { location, place, anchor } = resolver( { interior, npc }, { atlas: STREET_ATLAS, obstacles: LAMP, doors: [ door ] } ).resolve( { kind: 'street', parcelId: 'p5' }, 1 );
		expect( place ).toEqual( { parcelId: 'p5' } );
		expect( anchor ).toBeNull();
		// Local +z runs out of the lot toward the curb; the floor is the sidewalk's own top.
		expect( location.origin ).toEqual( { x: 32.2, y: 0.2, z: 144.5 } );
		expect( rotate2( { x: 0, z: 1 }, location.yawRadians ).x ).toBeCloseTo( -1, 6 );
		expect( [ location.width, location.depth ] ).toEqual( [ 6, 3 ] );
		for ( const corner of corners( location ) ) {

			expect( corner[ 0 ] ).toBeLessThanOrEqual( 33.7 + 1e-6 );
			expect( inside( SIDEWALK, shrink( corner, location ) ) ).toBe( true );

		}
		const doorway = location.entries.find( ( entry ) => entry.entryId === 'doorway' );
		expect( doorway.position.z ).toBe( -1.5 );
		expect( doorway.position.x ).toBeCloseTo( rotate2( { x: 0, z: 145.3 - 144.5 }, -location.yawRadians ).x, 5 );
		// The lamp post stands in the frame; its head, overhead, does not.
		expect( location.blockedZones ).toEqual( [ { blockerId: 'fixture:0', center: { x: -0.4, z: 1.2 }, width: 0.28, depth: 0.28 } ] );
		expect( location.receivingSurfaces[ 0 ].blockedRegions ).toHaveLength( 1 );

	} );

	it( 'keeps every element of a street scene on the sidewalk, out of the lot and clear of its fixtures', () => {

		const place = { kind: 'street', parcelId: 'p5', width: 8 };
		const spec = {
			contractVersion: '1.0', sceneId: 'hit', questId: 'q', seed: 5, purpose: 'crime-scene', place,
			actors: [
				{ actorId: 'victim', role: 'victim', identity: { kind: 'anonymous', gender: 'male', appearanceSeed: 1 }, pose: 'death-a', placement: { zone: 'center' } },
				...[ 0, 1, 2 ].map( ( index ) => ( {
					actorId: `guard-${index}`, role: 'officer', identity: { kind: 'anonymous', gender: 'female', appearanceSeed: index },
					pose: 'standing-guard', placement: { zone: 'perimeter' }
				} ) )
			],
			props: [ { propId: 'pool', kind: 'blood-pool', nearActorId: 'victim' } ],
			activeWhen: { kind: 'questStarted' }
		};
		const resolved = resolver( { interior, npc }, { atlas: STREET_ATLAS, obstacles: LAMP } ).resolve( place, 1 );
		const people = spec.actors.map( ( actor, index ) => ( { actorId: actor.actorId, gender: index ? 'female' : 'male', appearanceSeed: index } ) );
		const { assembly } = new SceneryCompiler().compile( spec, resolved, people );
		const post = [ 31, 144.1 ];
		for ( const entity of assembly.entities ) {

			const footprint = corners( { origin: entity.footprint.center, yawRadians: entity.footprint.yawRadians, width: entity.footprint.width, depth: entity.footprint.depth } );
			for ( const corner of footprint ) {

				expect( corner[ 0 ] ).toBeLessThan( 33.7 );
				expect( inside( SIDEWALK, corner ) ).toBe( true );

			}
			expect( inside( footprint, post ) ).toBe( false );
			expect( entity.transform.position.y ).toBeCloseTo( 0.2 - ( entity.asset?.groundContact?.y ?? 0 ), 6 );

		}

	} );

	it( 'refuses a street frame deeper than the sidewalk', () => {

		expect( () => resolver( { interior, npc }, { atlas: STREET_ATLAS } ).resolve( { kind: 'street', parcelId: 'p5', depth: 5 }, 1 ) )
			.toThrowError( expect.objectContaining( { code: 'E_SCENERY_NO_FIT', message: expect.stringMatching( /no level 6 by 5 m of pavement/ ) } ) );

	} );

	it( 'names what a place lacks', () => {

		const errors = [
			[ { kind: 'room', parcelId: 'p1', floor: 9, roomKinds: [ 'living' ] }, 'E_SCENERY_PLACE', /no floor 9/ ],
			[ { kind: 'room', parcelId: 'p1', floor: 1, roomId: 'nowhere' }, 'E_SCENERY_PLACE', /no room nowhere/ ],
			[ { kind: 'room', parcelId: 'p1', floor: 1, roomKinds: [ 'gym_floor' ] }, 'E_SCENERY_PLACE', /no gym_floor room/ ],
			[ { kind: 'room', parcelId: 'p2', floor: 0, roomKinds: [ 'living' ] }, 'E_SCENERY_PLACE', /p2 has no furnished interior/ ],
			[ { kind: 'room', parcelId: 'p1', floor: 1, roomId: 'f1-corridor' }, 'E_SCENERY_NO_FIT', /smaller than 3 by 3/ ],
			[ { kind: 'street', parcelId: 'p404' }, 'E_SCENERY_PLACE', /no parcel p404/ ]
		];
		for ( const [ place, code, message ] of errors ) {

			expect( () => resolver( { interior, npc }, { atlas: { parcels: [] } } ).resolve( place, 1 ) ).toThrowError( expect.objectContaining( { code, message: expect.stringMatching( message ) } ) );

		}
		expect( () => resolver().resolve( { kind: 'room', parcelId: 'p1', floor: 1, roomKinds: [ 'living' ] }, 1, { parcelId: 'p1', floor: 1, roomId: 'gone' } ) )
			.toThrowError( expect.objectContaining( { code: 'E_SCENERY_PLACE' } ) );

	} );

} );

function corners( location ) {

	return [ [ -1, -1 ], [ 1, -1 ], [ 1, 1 ], [ -1, 1 ] ].map( ( [ sx, sz ] ) => {

		const offset = rotate2( { x: sx * location.width / 2, z: sz * location.depth / 2 }, location.yawRadians );
		return [ location.origin.x + offset.x, location.origin.z + offset.z ];

	} );

}

function inside( polygon, [ x, z ] ) {

	let result = false;
	for ( let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index ++ ) {

		const [ ax, az ] = polygon[ previous ];
		const [ bx, bz ] = polygon[ index ];
		if ( ( az > z ) !== ( bz > z ) && x < ( bx - ax ) * ( z - az ) / ( bz - az ) + ax ) result = ! result;

	}
	return result;

}

function cross( u, v ) {

	const value = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x };
	return Object.fromEntries( Object.entries( value ).map( ( [ key, number ] ) => [ key, Math.round( number * 1e6 ) / 1e6 + 0 ] ) );

}

/** The same building turned about the world origin, as a plan at an angle would stand. */
function turnedInterior( turn ) {

	const point = ( [ x, z ] ) => {

		const turned = rotate2( { x, z }, turn );
		return [ turned.x, turned.z ];

	};
	const copy = structuredClone( interior );
	for ( const layout of Object.values( copy.layouts ) ) {

		for ( const room of layout.floor.rooms ) {

			room.polygon = room.polygon.map( point );
			room.holes = room.holes?.map( ( ring ) => ring.map( point ) );
			for ( const door of room.doors ) door.position = point( door.position );

		}
		for ( const item of layout.floor.furniture ) {

			item.position = point( item.position );
			item.rotationDeg += turn * 180 / Math.PI;

		}

	}
	return copy;

}

/** A frame corner pulled a millimetre inside, so a corner on the sidewalk's own edge reads as on it. */
function shrink( [ x, z ], location ) {

	return [ x + Math.sign( location.origin.x - x ) * 1e-3, z + Math.sign( location.origin.z - z ) * 1e-3 ];

}

/** Parcel p5 of a generated small city: its lot, footprint and access point, the sidewalk and curb in front of it. */
const SIDEWALK = [ [ 33.7, 110.5 ], [ 33.7, 160.5 ], [ 29.5, 160.5 ], [ 29.5, 110.5 ] ];
const STREET_ATLAS = {
	parcels: [ {
		id: 'p5',
		lot: [ [ 33.7, 128.5 ], [ 57.7, 128.5 ], [ 57.7, 160.5 ], [ 33.7, 160.5 ] ],
		footprint: [ [ 36, 130.5 ], [ 55.5, 130.5 ], [ 55.5, 158.5 ], [ 36, 158.5 ] ],
		access: { edgeId: 'e12', point: [ 33.7, 144.5 ] }
	} ],
	volumetric: { ground: [
		{ surface: 'block', bottom: 0, top: 0.2, polygon: [ [ 33.7, 128.5 ], [ 57.7, 128.5 ], [ 57.7, 160.5 ], [ 33.7, 160.5 ] ] },
		{ surface: 'sidewalk', bottom: 0, top: 0.2, polygon: SIDEWALK },
		{ surface: 'curb', bottom: 0, top: 0.2, polygon: [ [ 29.5, 110.5 ], [ 29.5, 160.5 ], [ 29.3, 160.5 ], [ 29.3, 110.5 ] ] },
		{ surface: 'roadway', bottom: 0, top: 0, polygon: [ [ 14.8, 100 ], [ 28.8, 100 ], [ 28.8, 170 ], [ 14.8, 170 ] ] }
	] }
};
/** That street's lamp post in front of p5, as street dressing reserves it: the post, and its head overhead. */
const LAMP = [
	{ footprint: [ [ 30.86, 143.96 ], [ 31.14, 143.96 ], [ 31.14, 144.24 ], [ 30.86, 144.24 ] ], bottom: 0.12, top: 6.095 },
	{ footprint: [ [ 30.3, 143.9 ], [ 31, 143.9 ], [ 31, 144.3 ], [ 30.3, 144.3 ] ], bottom: 5.8, top: 6.0 }
];
