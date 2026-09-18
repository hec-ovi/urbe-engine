// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { stubCanvas } from '../test-helpers/canvas.js';
import { Map3DView } from './Map3DView.js';

const world = {
	bounds: { min: [ 0, 0 ], max: [ 100, 100 ] },
	buildings: [
		{ ring: [ [ 10, 10 ], [ 30, 10 ], [ 30, 30 ], [ 10, 30 ] ], height: 12 },
		{ ring: [ [ 50, 50 ], [ 70, 50 ], [ 60, 70 ] ], height: 30 }
	],
	ground: [
		{ surface: 'roadway', polygon: [ [ 0, 40 ], [ 100, 40 ], [ 100, 48 ], [ 0, 48 ] ] },
		{ surface: 'sidewalk', polygon: [ [ 0, 48 ], [ 100, 48 ], [ 100, 51 ], [ 0, 51 ] ] }
	],
	transit: {
		routes: [
			{ id: 'bus-1', kind: 'bus', path: [ [ 2, 0.5, 10 ], [ 80, 4, 10 ] ] },
			{ id: 'subway-1', kind: 'subway', path: [ [ 20, -12, 30 ], [ 60, -12, 30 ] ] }
		],
		places: [
			{ id: 'bus:b0', refId: 'b0', kind: 'bus', point: [ 2, 0.5, 10 ] },
			{ id: 'subway:s0:0', refId: 's0', kind: 'subway', point: [ 20, 0, 30 ] }
		]
	}
};

/**
 * The map is the city as blocks: every parcel prism and every ground polygon
 * the atlas published, with the transit lines, the player and one route in it.
 * A prism that went missing is a building the player cannot find, so the
 * geometry is what the test reads.
 */
describe( 'Map3DView', () => {

	beforeEach( () => stubCanvas() );

	it( 'raises every building on the ground cover, draws transit at its published height, and shows the player and one route without a render loop', () => {

		const view = new Map3DView( { onClose: () => {} } );
		view.setWorld( world );

		const prisms = view.blocks.geometry;
		prisms.computeBoundingBox();
		expect( prisms.getAttribute( 'position' ).count ).toBeGreaterThan( 0 );
		expect( prisms.boundingBox.max.y ).toBe( 30 );
		expect( prisms.boundingBox.min.y ).toBeCloseTo( 0 );
		// Ground z maps onto -y of the shape and back onto +z of the scene.
		expect( prisms.boundingBox.max.z ).toBeCloseTo( 70 );
		expect( view.plates[ 0 ].geometry.getAttribute( 'position' ).count ).toBeGreaterThan( 0 );

		expect( view.transitRoutes.children.map( ( route ) => route.name ) ).toEqual( [
			'transit-route:bus-1', 'transit-route:subway-1'
		] );
		expect( view.transitRoutes.children[ 0 ].geometry.getAttribute( 'position' ).array ).toEqual(
			new Float32Array( [ 2, 0.5, 10, 80, 4, 10 ] )
		);
		expect( view.transitPlaces.children.map( ( place ) => place.userData.point ) ).toEqual( [
			[ 2, 0.5, 10 ], [ 20, 0, 30 ]
		] );

		view.setPlayer( { x: 20, y: 0, z: 20 }, 1 );
		expect( view.target.x ).toBe( 20 );
		expect( view.marker.visible ).toBe( true );
		expect( view.marker.rotation.y ).toBe( 1 );

		view.setRoute( { path: [ [ 2, 3 ], [ 8, 12 ], [ 15, 20 ] ], label: 'reach p9' } );
		expect( view.routeLine.name ).toBe( 'objective-route' );
		expect( view.routeLine.geometry.getAttribute( 'position' ).count ).toBe( 3 );
		expect( view.objectiveMark.position.toArray() ).toEqual( [ 15, 4, 20 ] );
		expect( view.objectiveMark.visible ).toBe( true );

		view.setRoute( null );
		expect( view.routeLine ).toBe( null );
		expect( view.objectiveMark.visible ).toBe( false );

		// No WebGL under jsdom: showing the panel degrades to a scene with no frame.
		expect( () => view.shown() ).not.toThrow();
		expect( view.renderer ).toBe( null );

	} );

} );
