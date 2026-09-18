// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { MainMenuView } from './MainMenuView.js';

const game = {
	id: 'game-1', name: 'Salt Wharf', cityName: 'Rain Sector', playable: true,
	mainSteps: 8, sideJobs: 4, interiors: 5, location: 'Quay Office', position: [ 12.4, 0.12, - 20.8 ],
	activeQuest: { title: 'Missing Freight', objective: 'Read the ledger' },
	inventory: [ { name: 'Brass key' } ], locations: [ { name: 'Quay Office' } ]
};

const city = {
	id: 'city-1', name: 'Rain Sector', seed: 'rain-44', size: 'medium', buildings: 146,
	interiorCount: 0, districts: 7, availableBuildings: [ { id: 'p11', label: 'Quay Office', type: 'office' } ]
};

describe( 'MainMenuView', () => {

	beforeEach( () => document.body.replaceChildren() );

	it( 'opens on the game directory, reports every connected action, and keeps cities out of the game list', async () => {

		const onContinue = vi.fn(), onSave = vi.fn(), onLoad = vi.fn(), onExportCity = vi.fn();
		const view = new MainMenuView( { onContinue, onSave, onLoad, onExportCity, onGenerateInstances: vi.fn() } );
		document.body.append( view.element );
		view.setLibrary( { games: [ game ], cities: [ city ] } );
		expect( view.element.hidden ).toBe( true );

		view.show();
		const user = userEvent.setup();
		expect( screen.getByRole( 'dialog', { name: 'URBE' } ) ).toBeTruthy();
		expect( document.activeElement ).toBe( screen.getByRole( 'button', { name: 'Continue game' } ) );
		expect( screen.getByRole( 'heading', { name: 'Your games' } ) ).toBeTruthy();
		expect( screen.getByText( 'Missing Freight' ) ).toBeTruthy();
		expect( screen.getByText( /X 12.4/ ) ).toBeTruthy();

		await user.click( screen.getByRole( 'button', { name: 'Continue game' } ) );
		expect( onContinue ).toHaveBeenCalledWith( 'game-1' );
		await user.click( screen.getByRole( 'button', { name: 'Save copy' } ) );
		expect( onSave ).toHaveBeenCalledWith( 'game-1' );

		const file = new File( [ '{}' ], 'night.urbegame.json', { type: 'application/json' } );
		Object.defineProperty( view.file, 'files', { configurable: true, value: [ file ] } );
		fireEvent.change( view.file );
		expect( onLoad ).toHaveBeenCalledWith( file );
		expect( view.file.value ).toBe( '' );

		await user.click( screen.getByRole( 'button', { name: 'Cities' } ) );
		expect( screen.getByRole( 'button', { name: 'Cities' } ).getAttribute( 'aria-current' ) ).toBe( 'page' );
		expect( screen.getByRole( 'heading', { name: 'Your cities' } ) ).toBeTruthy();
		expect( screen.getByRole( 'heading', { name: 'Rain Sector' } ) ).toBeTruthy();
		await user.click( screen.getByRole( 'button', { name: 'Export city' } ) );
		expect( onExportCity ).toHaveBeenCalledWith( 'city-1' );

		// A city is not a game: it continues at the interiors stage, never as a playthrough.
		await user.click( screen.getByRole( 'button', { name: 'Add interiors' } ) );
		expect( screen.getByRole( 'heading', { name: 'Playable interiors' } ) ).toBeTruthy();
		expect( screen.getByRole( 'button', { name: 'New game' } ).getAttribute( 'aria-current' ) ).toBe( 'page' );
		expect( screen.getByRole( 'button', { name: 'Step 3: Story and jobs' } ).disabled ).toBe( true );

		view.hide();
		expect( view.element.hidden ).toBe( true );

	} );

	it( 'disables the actions its caller did not connect and says why', () => {

		const view = new MainMenuView( {} );
		document.body.append( view.element );
		view.show();

		expect( screen.getByRole( 'button', { name: 'Continue game' } ).disabled ).toBe( true );
		expect( screen.getByRole( 'button', { name: 'Load game' } ).disabled ).toBe( true );
		expect( screen.getByText( 'Local file loading is unavailable in this runtime.' ) ).toBeTruthy();
		expect( document.activeElement ).toBe( screen.getByRole( 'button', { name: 'Games' } ) );

	} );

} );
