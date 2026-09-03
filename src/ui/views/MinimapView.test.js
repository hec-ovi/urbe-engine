// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { count, stubCanvas } from '../test-helpers/canvas.js';
import { MAP_COLORS } from './MapPainter.js';
import { MinimapView } from './MinimapView.js';

const MAP = {
	bounds: { min: [ 0, 0 ], max: [ 100, 100 ] },
	roads: [ { path: [ [ 0, 50 ], [ 100, 50 ] ], width: 8 } ],
	blocks: [ [ [ 10, 10 ], [ 40, 10 ], [ 40, 40 ], [ 10, 40 ] ] ],
	transit: {
		routes: [ { id: 'train-1', kind: 'train', path: [ [ 0, 20 ], [ 100, 20 ] ] } ],
		places: [ { id: 'train:t0:0', refId: 't0', kind: 'train', point: [ 25, 20 ] } ]
	}
};

/** The corner map blits the baked city once per update and marks venues live. */
describe( 'MinimapView', () => {

	let view;

	beforeEach( () => {

		stubCanvas();
		view = new MinimapView();
		document.body.replaceChildren( view.element );

	} );

	it( 'update blits the bake around the player and paints venues by state', () => {

		view.setMap( MAP );
		view.setVenues( [ { point: { x: 50, z: 50 }, open: true }, { point: { x: 52, z: 52 }, open: false } ] );
		view.update( { x: 50, z: 50 }, 0 );

		expect( count( view.context, 'drawImage' ) ).toBe( 1 );
		expect( view.context.calls ).toContainEqual( [ 'set', 'fillStyle', MAP_COLORS.venueOpen ] );
		expect( view.context.calls ).toContainEqual( [ 'set', 'fillStyle', MAP_COLORS.venueShut ] );

	} );

	it( 'bakes generated transit routes and station entries into the city layer', () => {

		view.setMap( MAP );

		expect( view.bake.context.calls ).toContainEqual( [ 'set', 'strokeStyle', MAP_COLORS.train ] );
		expect( view.bake.context.calls ).toContainEqual( [ 'strokeRect', 100.5, 92.5, 7, 7 ] );

	} );

	it( 'toggle hides it and a hidden map draws nothing', () => {

		view.setMap( MAP );
		view.toggle();
		view.update( { x: 0, z: 0 }, 0 );

		expect( view.element.hidden ).toBe( true );
		expect( count( view.context, 'drawImage' ) ).toBe( 0 );

	} );

	it( 'draws and clears the active objective route', () => {

		view.setMap( MAP );
		view.setRoute( { path: [ [ 45, 50 ], [ 50, 50 ], [ 60, 55 ] ], label: 'reach p9' } );
		view.update( { x: 45, z: 50 }, 0 );

		expect( view.context.calls ).toContainEqual( [ 'set', 'strokeStyle', MAP_COLORS.route ] );
		expect( count( view.context, 'stroke' ) ).toBeGreaterThan( 0 );
		expect( view.context.calls ).toContainEqual( [ 'set', 'fillStyle', MAP_COLORS.marker ] );

		view.context.calls.length = 0;
		view.setRoute( null );
		view.update( { x: 45, z: 50 }, 0 );
		expect( view.context.calls ).not.toContainEqual( [ 'set', 'strokeStyle', MAP_COLORS.route ] );

	} );

} );
