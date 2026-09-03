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

describe( 'NewGameView', () => {

	beforeEach( () => document.body.replaceChildren() );

	it( 'starts with only the city stage unlocked and explains an unavailable generator', () => {

		mount();
		expect( screen.getByRole( 'heading', { name: 'City geometry' } ) ).toBeTruthy();
		expect( screen.getByRole( 'button', { name: 'Step 2: Interiors' } ).disabled ).toBe( true );
		expect( screen.getByRole( 'button', { name: 'Generate city' } ).disabled ).toBe( true );
		expect( screen.getByText( 'City generation is not connected in the current runtime.' ) ).toBeTruthy();

	} );

	it( 'validates and reports the exact city brief', async () => {

		const onGenerateCity = vi.fn();
		const view = mount( { onGenerateCity } );
		const user = userEvent.setup();
		const name = screen.getByLabelText( 'City name' );
		const seed = screen.getByLabelText( 'Seed' );

		await user.clear( name );
		await user.clear( seed );
		await user.click( screen.getByRole( 'button', { name: 'Generate city' } ) );
		expect( screen.getByRole( 'alert' ).textContent ).toBe( 'City name and seed are required.' );
		expect( onGenerateCity ).not.toHaveBeenCalled();

		await user.type( name, 'Rain Sector' );
		await user.type( seed, 'rain-44' );
		await user.selectOptions( screen.getByLabelText( 'City size' ), 'large' );
		await user.click( screen.getByRole( 'button', { name: 'Generate city' } ) );
		expect( onGenerateCity ).toHaveBeenCalledWith( { name: 'Rain Sector', seed: 'rain-44', size: 'large' } );
		expect( view.error.hidden ).toBe( true );

	} );

	it( 'unlocks interiors only when the caller supplies a generated city', () => {

		const view = mount( { onGenerateCity: vi.fn(), onGenerateInstances: vi.fn() } );
		view.setCreationState( { city } );
		expect( screen.getByRole( 'heading', { name: 'Playable interiors' } ) ).toBeTruthy();
		expect( screen.getByText( '146 buildings ready.' ) ).toBeTruthy();
		expect( screen.getByRole( 'button', { name: 'Step 2: Interiors' } ).disabled ).toBe( false );
		expect( screen.getByRole( 'button', { name: 'Step 3: Story and jobs' } ).disabled ).toBe( true );

	} );

	it( 'requires a manual building selection and sends only selected eligible ids', async () => {

		const onGenerateInstances = vi.fn();
		const view = mount( { onGenerateInstances } );
		view.beginWithCity( city );
		const user = userEvent.setup();
		await user.selectOptions( screen.getByLabelText( 'Interior selection mode' ), 'manual' );
		await user.click( screen.getByRole( 'button', { name: 'Generate selected interiors' } ) );
		expect( screen.getByRole( 'alert' ).textContent ).toBe( 'Select at least one building for a manual interior build.' );

		await user.click( screen.getByRole( 'checkbox', { name: /Quay Office/ } ) );
		await user.click( screen.getByRole( 'checkbox', { name: /Bar Nadir/ } ) );
		expect( screen.getByRole( 'checkbox', { name: /Substation/ } ).disabled ).toBe( true );
		await user.click( screen.getByRole( 'button', { name: 'Generate selected interiors' } ) );
		expect( onGenerateInstances ).toHaveBeenCalledWith( {
			cityId: 'city-rain', mode: 'manual', count: 2, buildingIds: [ 'p11', 'p64' ]
		} );

	} );

	it( 'validates automatic interior count before reporting generation', async () => {

		const onGenerateInstances = vi.fn();
		const view = mount( { onGenerateInstances } );
		view.beginWithCity( city );
		const user = userEvent.setup();
		const amount = screen.getByLabelText( 'Interior count' );
		await user.clear( amount );
		await user.type( amount, '25' );
		await user.click( screen.getByRole( 'button', { name: 'Generate selected interiors' } ) );
		expect( screen.getByRole( 'alert' ).textContent ).toBe( 'Interior count must be between 1 and 24.' );
		expect( onGenerateInstances ).not.toHaveBeenCalled();

	} );

	it( 'reports automatic interior generation with its requested count', async () => {

		const onGenerateInstances = vi.fn();
		const view = mount( { onGenerateInstances } );
		view.beginWithCity( city );
		const user = userEvent.setup();
		const amount = screen.getByLabelText( 'Interior count' );
		await user.clear( amount );
		await user.type( amount, '7' );
		await user.click( screen.getByRole( 'button', { name: 'Generate selected interiors' } ) );
		expect( onGenerateInstances ).toHaveBeenCalledWith( {
			cityId: 'city-rain', mode: 'automatic', count: 7, buildingIds: []
		} );

	} );

	it( 'carries generated interiors into the story request', async () => {

		const onGenerateQuests = vi.fn();
		const view = mount( { onGenerateQuests } );
		view.setCreationState( { city, instances: { ids: [ 'p11', 'p64' ], count: 2 } } );
		const user = userEvent.setup();
		await user.type( screen.getByLabelText( 'Main story direction' ), 'A missing freight investigation' );
		const sideJobs = screen.getByLabelText( 'Side jobs' );
		await user.clear( sideJobs );
		await user.type( sideJobs, '6' );
		await user.click( screen.getByRole( 'button', { name: 'Generate story and jobs' } ) );
		expect( onGenerateQuests ).toHaveBeenCalledWith( {
			cityId: 'city-rain', interiorIds: [ 'p11', 'p64' ], mainBrief: 'A missing freight investigation', sideJobs: 6
		} );

	} );

	it( 'creates a game only after all three source artifacts exist', async () => {

		const onCreateGame = vi.fn();
		const view = mount( { onCreateGame } );
		view.setCreationState( {
			city,
			instances: { ids: [ 'p11', 'p64' ], count: 2 },
			quests: { id: 'quests-rain', mainSteps: 9, sideJobs: 4 }
		} );
		expect( screen.getByRole( 'heading', { name: 'Playable game' } ) ).toBeTruthy();
		expect( screen.getByText( '9 steps' ) ).toBeTruthy();
		await userEvent.setup().click( screen.getByRole( 'button', { name: 'Create playable game' } ) );
		expect( onCreateGame ).toHaveBeenCalledWith( {
			cityId: 'city-rain', interiorIds: [ 'p11', 'p64' ], questId: 'quests-rain'
		} );

	} );

	it( 'locks actions while a stage is busy, shows caller errors and reports cancel', async () => {

		const onCancel = vi.fn();
		const view = mount( { onGenerateCity: vi.fn(), onCancel } );
		view.setCreationState( { busy: 'city', error: 'City generation failed validation.' } );
		expect( screen.getByRole( 'button', { name: 'Generate city' } ).disabled ).toBe( true );
		expect( screen.getByRole( 'alert' ).textContent ).toBe( 'City generation failed validation.' );
		await userEvent.setup().click( screen.getByRole( 'button', { name: 'Back to library' } ) );
		expect( onCancel ).toHaveBeenCalledOnce();

	} );

} );
