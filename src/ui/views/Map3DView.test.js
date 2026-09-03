// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Map3DView, prismGeometry, plateGeometry } from './Map3DView.js';

const world = {
	bounds: { min: [ 0, 0 ], max: [ 100, 100 ] },
	buildings: [
		{ ring: [ [ 10, 10 ], [ 30, 10 ], [ 30, 30 ], [ 10, 30 ] ], height: 12 },
		{ ring: [ [ 50, 50 ], [ 70, 50 ], [ 60, 70 ] ], height: 30 }
	],
	ground: [
		{ surface: 'roadway', polygon: [ [ 0, 40 ], [ 100, 40 ], [ 100, 48 ], [ 0, 48 ] ] },
		{ surface: 'sidewalk', polygon: [ [ 0, 48 ], [ 100, 48 ], [ 100, 51 ], [ 0, 51 ] ] }
	]
};

/**
 * The map is the city as blocks: every parcel prism and every ground polygon
 * the atlas published, with the player in it. A prism that went missing is a
 * building the player cannot find, so the geometry is what the test reads.
 */
describe( 'Map3DView', () => {

	it( 'raises every building as a prism of its own height on the ground cover', () => {

		const prisms = prismGeometry( world.buildings );
		prisms.computeBoundingBox();

		expect( prisms.getAttribute( 'position' ).count ).toBeGreaterThan( 0 );
		expect( prisms.boundingBox.max.y ).toBe( 30 );
		expect( prisms.boundingBox.min.y ).toBeCloseTo( 0 );
		// Ground z maps onto -y of the shape and back onto +z of the scene.
		expect( prisms.boundingBox.max.z ).toBeCloseTo( 70 );
		expect( plateGeometry( world.ground, 'roadway', 0.05 ).getAttribute( 'position' ).count ).toBe( 4 );

	} );

	it( 'follows the player until the map is turned, and comes back on centre', () => {

		const view = new Map3DView( { onClose: () => {} } );
		view.setWorld( world );
		view.setPlayer( { x: 20, y: 0, z: 20 }, 1 );

		expect( view.target.x ).toBe( 20 );
		expect( view.marker.visible ).toBe( true );
		expect( view.marker.rotation.y ).toBe( 1 );

		// No WebGL under jsdom: showing the panel degrades to a scene with no frame.
		expect( () => view.shown() ).not.toThrow();
		expect( view.renderer ).toBe( null );

	} );

	it( 'shows and clears one objective route without starting a render loop', () => {

		const view = new Map3DView( { onClose: () => {} } );
		view.setWorld( world );
		view.setRoute( { path: [ [ 2, 3 ], [ 8, 12 ], [ 15, 20 ] ], label: 'reach p9' } );

		expect( view.routeLine.name ).toBe( 'objective-route' );
		expect( view.routeLine.geometry.getAttribute( 'position' ).count ).toBe( 3 );
		expect( view.objectiveMark.position.toArray() ).toEqual( [ 15, 4, 20 ] );
		expect( view.objectiveMark.visible ).toBe( true );
		expect( view.renderer ).toBe( null );

		view.setRoute( null );
		expect( view.routeLine ).toBe( null );
		expect( view.objectiveMark.visible ).toBe( false );

	} );

} );
