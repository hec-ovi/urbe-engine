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

	it( 'opens as a full front door and switches between game and city directories', async () => {

		const view = new MainMenuView( {} );
		document.body.append( view.element );
		view.setLibrary( { games: [ game ], cities: [ city ] } );

		expect( view.element.hidden ).toBe( true );
		view.show();
		expect( screen.getByRole( 'heading', { name: 'URBE' } ) ).toBeTruthy();
		expect( screen.getByRole( 'heading', { name: 'Your games' } ) ).toBeTruthy();
		expect( screen.getByText( 'Missing Freight' ) ).toBeTruthy();
		expect( screen.getByText( /X 12.4/ ) ).toBeTruthy();

		await userEvent.setup().click( screen.getByRole( 'button', { name: 'Cities' } ) );
		expect( screen.getByRole( 'heading', { name: 'Your cities' } ) ).toBeTruthy();
		expect( screen.getByRole( 'heading', { name: 'Rain Sector' } ) ).toBeTruthy();
		view.hide();
		expect( view.element.hidden ).toBe( true );

	} );

	it( 'continues the latest game and reports save intents by game id', async () => {

		const onContinue = vi.fn();
		const onSave = vi.fn();
		const view = new MainMenuView( { onContinue, onSave } );
		document.body.append( view.element );
		view.setLibrary( { games: [ game ] } );
		view.show();
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Continue game' } ) );
		expect( onContinue ).toHaveBeenCalledWith( 'game-1' );
		await user.click( screen.getByRole( 'button', { name: 'Save copy' } ) );
		expect( onSave ).toHaveBeenCalledWith( 'game-1' );

	} );

	it( 'loads the selected local file and clears the input', () => {

		const onLoad = vi.fn();
		const view = new MainMenuView( { onLoad } );
		document.body.append( view.element );
		view.show();
		const file = new File( [ '{}' ], 'night.urbegame.json', { type: 'application/json' } );
		Object.defineProperty( view.file, 'files', { configurable: true, value: [ file ] } );
		fireEvent.change( view.file );
		expect( onLoad ).toHaveBeenCalledWith( file );
		expect( view.file.value ).toBe( '' );

	} );

	it( 'keeps unsupported and unavailable actions disabled with an explanation', () => {

		const view = new MainMenuView( {} );
		document.body.append( view.element );
		view.show();
		expect( screen.getByRole( 'button', { name: 'Continue game' } ).disabled ).toBe( true );
		expect( screen.getByRole( 'button', { name: 'Load game' } ).disabled ).toBe( true );
		expect( screen.getByText( 'Local file loading is unavailable in this runtime.' ) ).toBeTruthy();

	} );

	it( 'continues an existing city at the interiors stage', async () => {

		const view = new MainMenuView( { onGenerateInstances: vi.fn() } );
		document.body.append( view.element );
		view.setLibrary( { cities: [ city ] } );
		view.show();
		await userEvent.setup().click( screen.getByRole( 'button', { name: 'Cities' } ) );
		await userEvent.setup().click( screen.getByRole( 'button', { name: 'Add interiors' } ) );
		expect( screen.getByRole( 'heading', { name: 'Playable interiors' } ) ).toBeTruthy();
		expect( screen.getByRole( 'button', { name: 'Step 1: City' } ).disabled ).toBe( false );
		expect( screen.getByRole( 'button', { name: 'Step 3: Story and jobs' } ).disabled ).toBe( true );

	} );

	it( 'reports city export without treating the city as a playable game', async () => {

		const onExportCity = vi.fn();
		const view = new MainMenuView( { onExportCity } );
		document.body.append( view.element );
		view.setLibrary( { cities: [ city ] } );
		view.show();
		const user = userEvent.setup();
		await user.click( screen.getByRole( 'button', { name: 'Cities' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Export city' } ) );
		expect( onExportCity ).toHaveBeenCalledWith( 'city-1' );

	} );

} );
