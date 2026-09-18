// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { NewGameView } from './NewGameView.js';

function mount( callbacks = {} ) {

	const view = new NewGameView( callbacks );
	document.body.append( view.element );
	return view;

}

const city = {
	id: 'city-rain', name: 'Rain Sector', seed: 'rain-44', size: 'medium', buildingCount: 146,
	availableBuildings: [
		{ id: 'p11', label: 'Quay Office', type: 'office' },
		{ id: 'p64', label: 'Bar Nadir', type: 'business' },
		{ id: 'p90', label: 'Substation', type: 'utility', eligible: false }
	]
};

const alerts = () => screen.getAllByRole( 'alert' ).map( ( node ) => node.textContent );

describe( 'NewGameView', () => {

	beforeEach( () => document.body.replaceChildren() );

	it( 'stage 1: only the city stage is unlocked, a missing generator is explained, and the chosen size goes out', async () => {

		mount();
		expect( screen.getByRole( 'heading', { name: 'Choose your city' } ) ).toBeTruthy();
		expect( screen.getByRole( 'button', { name: 'Step 2: Interiors' } ).disabled ).toBe( true );
		expect( screen.getByRole( 'button', { name: 'Next' } ).disabled ).toBe( true );
		expect( screen.getByText( 'City generation is not connected in the current runtime.' ) ).toBeTruthy();

		document.body.replaceChildren();
		const onGenerateCity = vi.fn();
		mount( { onGenerateCity } );
		const user = userEvent.setup();
		expect( screen.queryByLabelText( 'City name' ) ).toBeNull();
		expect( screen.queryByLabelText( 'Seed' ) ).toBeNull();
		await user.selectOptions( screen.getByLabelText( 'City size' ), 'large' );
		expect( screen.getByRole( 'option', { name: 'Big' } ).selected ).toBe( true );
		await user.click( screen.getByRole( 'button', { name: 'Next' } ) );
		expect( onGenerateCity ).toHaveBeenCalledWith( { size: 'large' } );

	} );

	it( 'stage 2: a generated city unlocks interiors, the count stays within 9 and 24, and manual mode sends the eligible ids it selected', async () => {

		const onGenerateInstances = vi.fn();
		const view = mount( { onGenerateInstances } );
		view.beginWithCity( city );
		const user = userEvent.setup();
		const generate = screen.getByRole( 'button', { name: 'Generate selected interiors' } );

		expect( screen.getByRole( 'heading', { name: 'Playable interiors' } ) ).toBeTruthy();
		expect( screen.getByText( '146 buildings ready.' ) ).toBeTruthy();
		expect( screen.getByRole( 'button', { name: 'Step 2: Interiors' } ).disabled ).toBe( false );
		expect( screen.getByRole( 'button', { name: 'Step 3: Story and jobs' } ).disabled ).toBe( true );

		const amount = screen.getByLabelText( 'Interior count' );
		expect( amount.value ).toBe( '9' );
		expect( amount.min ).toBe( '9' );
		await user.clear( amount );
		await user.type( amount, '8' );
		await user.click( generate );
		expect( alerts() ).toContain( 'Automatic interior count must be between 9 and 24.' );
		expect( onGenerateInstances ).not.toHaveBeenCalled();

		await user.clear( amount );
		await user.type( amount, '12' );
		await user.click( generate );
		expect( onGenerateInstances ).toHaveBeenLastCalledWith( {
			cityId: 'city-rain', mode: 'automatic', count: 12, buildingIds: []
		} );

		await user.selectOptions( screen.getByLabelText( 'Interior selection mode' ), 'manual' );
		await user.click( generate );
		expect( alerts() ).toContain( 'Select at least one building for a manual interior build.' );

		await user.click( screen.getByRole( 'checkbox', { name: /Quay Office/ } ) );
		await user.click( screen.getByRole( 'checkbox', { name: /Bar Nadir/ } ) );
		expect( screen.getByRole( 'checkbox', { name: /Substation/ } ).disabled ).toBe( true );
		await user.click( generate );
		expect( onGenerateInstances ).toHaveBeenLastCalledWith( {
			cityId: 'city-rain', mode: 'manual', count: 2, buildingIds: [ 'p11', 'p64' ]
		} );

	} );

	it( 'stages 3 and 4: side jobs stay within 0 and 3, the story carries its interiors, and a game is created with or without quests while busy locks the pane', async () => {

		const onGenerateQuests = vi.fn();
		const onCreateGame = vi.fn();
		const view = mount( { onGenerateQuests, onCreateGame } );
		view.setCreationState( { city, instances: { ids: [ 'p11', 'p64' ], count: 2 } } );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'Play without quests' } ) );
		expect( onCreateGame ).toHaveBeenLastCalledWith( { cityId: 'city-rain', interiorIds: [ 'p11', 'p64' ], questId: null } );

		const sideJobs = screen.getByLabelText( 'Side jobs' );
		expect( sideJobs.value ).toBe( '3' );
		expect( sideJobs.max ).toBe( '3' );
		await user.clear( sideJobs );
		await user.type( sideJobs, '4' );
		await user.click( screen.getByRole( 'button', { name: 'Generate story and jobs' } ) );
		expect( alerts() ).toContain( 'Side jobs must be between 0 and 3.' );
		expect( onGenerateQuests ).not.toHaveBeenCalled();

		await user.clear( sideJobs );
		await user.type( sideJobs, '3' );
		await user.click( screen.getByRole( 'button', { name: 'Generate story and jobs' } ) );
		expect( onGenerateQuests ).toHaveBeenCalledWith( {
			cityId: 'city-rain', interiorIds: [ 'p11', 'p64' ], mainBrief: '', sideJobs: 3
		} );

		view.setCreationState( { quests: { id: 'quests-rain', mainSteps: 9, sideJobs: 3 } } );
		expect( screen.getByRole( 'heading', { name: 'Playable game' } ) ).toBeTruthy();
		expect( screen.getByText( '9 steps' ) ).toBeTruthy();
		await user.click( screen.getByRole( 'button', { name: 'Play' } ) );
		expect( onCreateGame ).toHaveBeenLastCalledWith( {
			cityId: 'city-rain', interiorIds: [ 'p11', 'p64' ], questId: 'quests-rain'
		} );

		view.setCreationState( { busy: 'game', error: 'Game creation failed validation.' } );
		expect( screen.getByRole( 'button', { name: 'Play' } ).disabled ).toBe( true );
		expect( view.gamePane.getAttribute( 'aria-busy' ) ).toBe( 'true' );
		expect( alerts() ).toContain( 'Game creation failed validation.' );

	} );

} );
