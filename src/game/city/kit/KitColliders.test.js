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
