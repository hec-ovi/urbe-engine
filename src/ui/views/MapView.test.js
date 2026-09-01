// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { count, stubCanvas } from '../test-helpers/canvas.js';
import { MAP_COLORS } from './MapPainter.js';
import { MapView } from './MapView.js';

const MAP = {
	bounds: { min: [ 0, 0 ], max: [ 100, 100 ] },
	roads: [ { path: [ [ 0, 50 ], [ 100, 50 ] ], width: 8 } ],
	blocks: [ [ [ 10, 10 ], [ 40, 10 ], [ 40, 40 ], [ 10, 40 ] ] ],
	stations: [ { point: [ 20, 50 ], name: 'Dock' }, { point: [ 80, 50 ], name: 'Mill' } ],
	markers: [ { point: [ 60, 60 ], label: 'meet Ada' } ]
};

/** The map draws what it is handed and only redraws when something moved. */
describe( 'MapView', () => {

	let view, onClose;

	beforeEach( () => {

		stubCanvas();
		onClose = vi.fn();
		view = new MapView( { onClose } );
		document.body.replaceChildren( view.element );

	} );

	it( 'setMap bakes the city once and draws it with stations and markers', () => {

		view.setMap( MAP );

		expect( count( view.context, 'drawImage' ) ).toBe( 1 );
		expect( count( view.context, 'strokeRect' ) ).toBe( 2 );
		expect( view.context.calls ).toContainEqual( [ 'fillText', 'meet Ada', expect.any( Number ), expect.any( Number ) ] );
		expect( screen.getByText( 'N' ) ).toBeTruthy();
		expect( screen.getByText( 'venue open' ) ).toBeTruthy();
		expect( screen.getByText( 'station' ) ).toBeTruthy();

	} );

	it( 'venues paint in their open and shut colours', () => {

		view.setMap( MAP );
		view.setVenues( [ { point: { x: 30, z: 30 }, open: true }, { point: { x: 70, z: 70 }, open: false } ] );

		expect( view.context.calls ).toContainEqual( [ 'set', 'fillStyle', MAP_COLORS.venueOpen ] );
		expect( view.context.calls ).toContainEqual( [ 'set', 'fillStyle', MAP_COLORS.venueShut ] );

	} );

	it( 'setPlayer follows the player and skips a redraw when nothing changed', () => {

		view.setMap( MAP );
		view.setPlayer( { x: 12, z: 34 }, 0.5 );
		view.setPlayer( { x: 12, z: 34 }, 0.5 );

		expect( count( view.context, 'drawImage' ) ).toBe( 2 );
		expect( view.camera.centre ).toEqual( [ 12, 34 ] );

	} );

	it( 'dragging pans, stops following, and centre on me comes back', async () => {

		view.setMap( MAP );
		view.setPlayer( { x: 50, z: 50 }, 0 );
		const before = count( view.context, 'drawImage' );

		fireEvent.pointerDown( view.stage, { clientX: 100, clientY: 100 } );
		fireEvent.pointerMove( view.stage, { clientX: 120, clientY: 90 } );
		fireEvent.pointerUp( view.stage, { clientX: 120, clientY: 90 } );

		expect( count( view.context, 'drawImage' ) ).toBe( before + 1 );
		expect( view.camera.centre ).toEqual( [ 50 - 20 / view.camera.zoom, 50 + 10 / view.camera.zoom ] );

		view.setPlayer( { x: 60, z: 60 }, 0 );
		expect( view.camera.centre ).not.toEqual( [ 60, 60 ] );

		await userEvent.setup().click( screen.getByRole( 'button', { name: 'centre on me' } ) );
		expect( view.camera.centre ).toEqual( [ 60, 60 ] );

	} );

	it( 'the wheel zooms about the cursor and redraws once', () => {

		view.setMap( MAP );
		const zoom = view.camera.zoom;
		const before = count( view.context, 'drawImage' );

		fireEvent.wheel( view.stage, { deltaY: - 100, clientX: 0, clientY: 0 } );

		expect( view.camera.zoom ).toBeGreaterThan( zoom );
		expect( count( view.context, 'drawImage' ) ).toBe( before + 1 );

	} );

	it( 'Esc in the header closes', async () => {

		await userEvent.setup().click( screen.getByRole( 'button', { name: 'close' } ) );
		expect( onClose ).toHaveBeenCalledOnce();

	} );

} );
