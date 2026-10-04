import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { KitPlacement } from './KitPlacement.js';
import { buildingBoxes } from './KitColliders.js';
import { interiorOpenings } from './KitOpenings.js';

/**
 * What a kit building is to the player's body, from the records assembly
 * publishes: the walls follow the building, not the lot it owns, and the plan's
 * own ground-level geometry is solid where it stands proud of it.
 */

/** Three bays by four, which is the 24 by 32 m lot the record's plan names. */
const PLAN = { id: 'plan', baysAcross: 3, baysDeep: 4 };
/** The massing inset two metres per side, the setback measuring 1.4 to 8 m. */
const FOOTPRINT = { u0: 2, v0: 2, u1: 22, v1: 30 };
const ORIGIN = [ 100, 0, 50 ];
const ROTATION = Math.PI / 2;
const HEIGHT = 20;

/** A lot-frame point in the world, the way assembly writes one. */
function world( u, v ) {

	return [
		ORIGIN[ 0 ] + u * Math.cos( ROTATION ) + v * Math.sin( ROTATION ),
		ORIGIN[ 2 ] - u * Math.sin( ROTATION ) + v * Math.cos( ROTATION )
	];

}

/** One parcel's placement record: its frame and the world box of its massing. */
function record() {

	const corners = ring().map( ( [ u, v ] ) => world( u, v ) );

	return {
		parcel: 'p1', plan: PLAN.id, origin: ORIGIN, rotationY: ROTATION,
		bounds: {
			min: [ Math.min( ...corners.map( ( c ) => c[ 0 ] ) ), 0, Math.min( ...corners.map( ( c ) => c[ 1 ] ) ) ],
			max: [ Math.max( ...corners.map( ( c ) => c[ 0 ] ) ), HEIGHT, Math.max( ...corners.map( ( c ) => c[ 1 ] ) ) ]
		},
		signText: null, family: 'mirror-frame', floors: 6, tint: 'p1'
	};

}

function ring() {

	const { u0, v0, u1, v1 } = FOOTPRINT;

	return [ [ u0, v0 ], [ u1, v0 ], [ u1, v1 ], [ u0, v1 ] ];

}

/** The ground floor of the composed blueprint, with the street entrance in it. */
function blueprint() {

	return {
		floors: [ {
			index: 0, elevation: 0, outline: ring().map( ( [ u, v ] ) => world( u, v ) ),
			openings: [ { kind: 'door', doorRole: 'main', edge: 0, offset: 8.5, width: 3, height: 2.4, sill: 0 } ]
		} ],
		roof: {}
	};

}

/** The same building drawn as a shop: a glassless front ten metres wide, and a stair head through its roof. */
function shopfront() {

	const [ x, z ] = world( 12, 15 );

	return {
		floors: [ {
			index: 0, elevation: 0, outline: ring().map( ( [ u, v ] ) => world( u, v ) ),
			openings: [ { kind: 'openFront', accessRole: 'main', edge: 0, offset: 5, width: 10, height: 3.5, sill: 0 } ]
		} ],
		roof: { bulkhead: { center: [ x, z ], axis: [ 1, 0 ], width: 3, depth: 4 } }
	};

}

function placementOf( { surfaces = [] } = {} ) {

	return new KitPlacement( 'p1', record(), { ...PLAN, surfaces } );

}

/** Whether a lot-frame point stands inside any of these cuboids. */
function solidAt( placement, boxes, u, y, v ) {

	const point = placement.point( u, y, v );

	return boxes.some( ( box ) => {

		const local = new THREE.Vector3( point.x - box.center[ 0 ], point.y - box.center[ 1 ], point.z - box.center[ 2 ] )
			.applyAxisAngle( UP, - box.rotationY );

		return Math.abs( local.x ) <= box.halfExtents[ 0 ]
			&& Math.abs( local.y ) <= box.halfExtents[ 1 ]
			&& Math.abs( local.z ) <= box.halfExtents[ 2 ];

	} );

}

const UP = new THREE.Vector3( 0, 1, 0 );

describe( 'kit building colliders', () => {

	it( 'leaves the ground between the facade and the lot line open', () => {

		const placement = placementOf();
		const boxes = buildingBoxes( placement );

		// A metre in front of the facade, and still a metre inside the lot the
		// old ring walled off.
		expect( solidAt( placement, boxes, 12, 1, FOOTPRINT.v0 - 1 ) ).toBe( false );

	} );

	it( 'stands the wall on the footprint line', () => {

		const placement = placementOf();
		const boxes = buildingBoxes( placement );

		expect( solidAt( placement, boxes, 12, 1, FOOTPRINT.v0 + 0.05 ) ).toBe( true );

	} );

	it( 'cuts the entrance out of the wall the door stands in', () => {

		const placement = placementOf();
		const boxes = buildingBoxes( placement, { openings: interiorOpenings( placement, blueprint() ) } );

		// The opening sits 8.5 m along the facade, which is 10.5 m across the lot.
		expect( solidAt( placement, boxes, 12, 1, FOOTPRINT.v0 + 0.25 ) ).toBe( false );
		expect( solidAt( placement, boxes, 4, 1, FOOTPRINT.v0 + 0.25 ) ).toBe( true );

	} );

	it( 'stands every building on a slab of its own under the whole footprint, the street\'s cover stopping at it', () => {

		const placement = placementOf();
		const boxes = buildingBoxes( placement, { openings: interiorOpenings( placement, shopfront() ) } );

		for ( const [ u, v ] of [ [ 12, 15 ], [ FOOTPRINT.u0 + 0.6, FOOTPRINT.v0 + 0.6 ], [ FOOTPRINT.u1 - 0.6, FOOTPRINT.v1 - 0.6 ] ] ) {

			expect( solidAt( placement, boxes, u, - 0.05, v ) ).toBe( true );
			expect( solidAt( placement, boxes, u, 0.05, v ) ).toBe( false );

		}
		// Not under the paving between the facade and the lot line, which is the street's.
		expect( solidAt( placement, boxes, 12, - 0.05, FOOTPRINT.v0 - 0.5 ) ).toBe( false );

	} );

	it( 'lays that slab under the lowest floor a furnished building stands', () => {

		const placement = placementOf();
		const rect = { ...FOOTPRINT };
		const boxes = buildingBoxes( placement, { storeys: [ { elevation: 0, rect }, { elevation: - 4.5, rect } ] } );

		expect( solidAt( placement, boxes, 12, - 4.6, 15 ) ).toBe( true );
		expect( solidAt( placement, boxes, 12, - 0.05, 15 ) ).toBe( false );

	} );

	it( 'closes a building with no interior: its open front and its stair head stand whole', () => {

		const placement = placementOf();
		const openings = interiorOpenings( placement, shopfront() );
		const open = buildingBoxes( placement, { openings } );
		const closed = buildingBoxes( placement, { openings, closed: true } );
		const top = placement.base + placement.height;

		// The front stands 5 to 15 m along face 0, 7 to 17 m across the lot,
		// and the stair head comes up through the middle of the roof.
		expect( solidAt( placement, open, 12, 1, FOOTPRINT.v0 + 0.25 ) ).toBe( false );
		expect( solidAt( placement, closed, 12, 1, FOOTPRINT.v0 + 0.25 ) ).toBe( true );
		expect( solidAt( placement, open, 12, top - 0.2, 15 ) ).toBe( false );
		expect( solidAt( placement, closed, 12, top - 0.2, 15 ) ).toBe( true );

	} );

	it( 'keeps a closed building\'s entrance cut out of its ground band, so its steps stay walkable up to the wall', () => {

		const steps = new THREE.BoxGeometry( 20, 0.43, 1.65 ).translate( 12, 0.215, 1.175 );
		const placement = placementOf( { surfaces: [ { geometry: steps } ] } );
		const boxes = buildingBoxes( placement, { openings: interiorOpenings( placement, shopfront() ), closed: true } );

		expect( solidAt( placement, boxes, 12, 0.2, 1 ) ).toBe( false );
		expect( solidAt( placement, boxes, 4, 0.2, 1 ) ).toBe( true );
		expect( solidAt( placement, boxes, 12, 0.2, FOOTPRINT.v0 + 0.25 ) ).toBe( true );

	} );

	it( 'stands the plan\'s own plinth where it is proud of the footprint', () => {

		// A plinth 1.65 m proud of face 0 and 0.43 m high, as the mirror families
		// carry it, in the plan's own frame.
		const plinth = new THREE.BoxGeometry( 20, 0.43, 1.65 ).translate( 12, 0.215, 1.175 );
		const placement = placementOf( { surfaces: [ { geometry: plinth } ] } );
		const boxes = buildingBoxes( placement );

		expect( solidAt( placement, boxes, 12, 0.2, 1 ) ).toBe( true );
		expect( solidAt( placement, boxes, 12, 0.8, 1 ) ).toBe( false );

	} );

} );
