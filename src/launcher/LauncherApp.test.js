// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { LauncherApp } from './LauncherApp.js';

const city = {
	id: 'rain-city', name: 'Rain Sector', seed: 'rain-44', size: 'small', buildings: 80, interiorCount: 0, districts: 4,
	availableBuildings: [
		{ id: 'p11', label: 'Quay Office', type: 'office' },
		{ id: 'p64', label: 'Bar Nadir', type: 'business' }
	]
};

const game = {
	id: 'rain-game', name: 'Salt Wharf', cityName: 'Rain Sector', playable: true, mainSteps: 8, sideJobs: 3,
	interiors: 2, location: 'Quay Office', position: [ 12, 0.12, - 20 ],
	activeQuest: { title: 'Missing Freight', objective: 'Read the ledger' }, inventory: [], locations: []
};

const emptyCatalog = { games: [], cities: [] };
const interiorIds = [ 'p11', 'p17', 'p22', 'p35', 'p41', 'p52', 'p64', 'p71', 'p79' ];

function api( overrides = {} ) {

	return {
		catalog: vi.fn().mockResolvedValue( emptyCatalog ),
		continueGame: vi.fn().mockResolvedValue( { playUrl: '/?mode=game&out=/out/rain' } ),
		exportGame: vi.fn().mockResolvedValue( { kind: 'game' } ),
		importGame: vi.fn().mockResolvedValue( { games: [ game ], cities: [ city ] } ),
		exportCity: vi.fn().mockResolvedValue( { kind: 'city' } ),
		generateCity: vi.fn().mockResolvedValue( { city } ),
		generateInstances: vi.fn().mockResolvedValue( { instances: { ids: interiorIds, count: 9 } } ),
		generateQuests: vi.fn().mockResolvedValue( { quests: { id: 'rain-quests', mainSteps: 8, sideJobs: 3 } } ),
		createGame: vi.fn().mockResolvedValue( { game, catalog: { games: [ game ], cities: [ city ] } } ),
		...overrides
	};

}

function make( apiValue = api() ) {

	const navigate = vi.fn();
	const download = vi.fn();
	const app = new LauncherApp( { mount: document.body, api: apiValue, navigate, download } );
	return { app, api: apiValue, navigate, download };

}

describe( 'LauncherApp', () => {

	beforeEach( () => {

		document.body.replaceChildren();

	} );

	it( 'mounts the real menu before loading its validated catalog', async () => {

		let release;
		const catalog = new Promise( ( resolve ) => { release = resolve; } );
		const made = make( api( { catalog: vi.fn().mockReturnValue( catalog ) } ) );
		const starting = made.app.start();
		expect( screen.getByRole( 'heading', { name: 'URBE' } ) ).toBeTruthy();
		expect( made.app.view.element.hidden ).toBe( false );
		release( { games: [ game ], cities: [ city ] } );
		await starting;
		expect( screen.getByRole( 'heading', { name: 'Salt Wharf' } ) ).toBeTruthy();

	} );

	it( 'mounts only once when start is called repeatedly', async () => {

		const made = make();
		await made.app.start();
		await made.app.start();
		expect( made.api.catalog ).toHaveBeenCalledOnce();
		expect( document.querySelectorAll( '.main-menu' ) ).toHaveLength( 1 );

	} );

	it( 'continues through the API and navigates only after a valid play URL', async () => {

		const made = make( api( { catalog: vi.fn().mockResolvedValue( { games: [ game ], cities: [] } ) } ) );
		await made.app.start();
		await userEvent.setup().click( screen.getByRole( 'button', { name: 'Continue game' } ) );
		await waitFor( () => expect( made.navigate ).toHaveBeenCalledWith( '/?mode=game&out=/out/rain' ) );
		expect( made.api.continueGame ).toHaveBeenCalledWith( 'rain-game' );

	} );

	it( 'runs city, interior, quest and game generation in order through the real wizard', async () => {

		const made = make();
		await made.app.start();
		const user = userEvent.setup();
		await user.click( screen.getByRole( 'button', { name: 'New game' } ) );
		await user.clear( screen.getByLabelText( 'City name' ) );
		await user.type( screen.getByLabelText( 'City name' ), 'Rain Sector' );
		await user.clear( screen.getByLabelText( 'Seed' ) );
		await user.type( screen.getByLabelText( 'Seed' ), 'rain-44' );
		await user.click( screen.getByRole( 'button', { name: 'Generate city' } ) );
		await screen.findByRole( 'heading', { name: 'Playable interiors' } );
		expect( made.api.generateCity ).toHaveBeenCalledWith( { name: 'Rain Sector', seed: 'rain-44', size: 'small' } );

		await user.click( screen.getByRole( 'button', { name: 'Generate selected interiors' } ) );
		await screen.findByRole( 'heading', { name: 'Story and side jobs' } );
		expect( made.api.generateInstances ).toHaveBeenCalledWith( {
			cityId: 'rain-city', mode: 'automatic', count: 9, buildingIds: []
		} );

		await user.click( screen.getByRole( 'button', { name: 'Generate story and jobs' } ) );
		await screen.findByRole( 'heading', { name: 'Playable game' } );
		expect( made.api.generateQuests ).toHaveBeenCalledWith( {
			cityId: 'rain-city', interiorIds, mainBrief: '', sideJobs: 3
		} );

		await user.click( screen.getByRole( 'button', { name: 'Create playable game' } ) );
		await screen.findByRole( 'heading', { name: 'Your games' } );
		expect( made.api.createGame ).toHaveBeenCalledWith( {
			cityId: 'rain-city', interiorIds, questId: 'rain-quests'
		} );
		expect( screen.getByRole( 'heading', { name: 'Salt Wharf' } ) ).toBeTruthy();

	} );

	it( 'refreshes the catalog after game creation when the result omits it', async () => {

		const apiValue = api( {
			catalog: vi.fn()
				.mockResolvedValueOnce( emptyCatalog )
				.mockResolvedValueOnce( { games: [ game ], cities: [ city ] } ),
			createGame: vi.fn().mockResolvedValue( { game } )
		} );
		const made = make( apiValue );
		await made.app.start();
		made.app.view.createNew();
		made.app.view.setCreationState( {
			city, instances: { ids: [ 'p11' ], count: 1 }, quests: { id: 'rain-quests', mainSteps: 8, sideJobs: 3 }
		} );
		await userEvent.setup().click( screen.getByRole( 'button', { name: 'Create playable game' } ) );
		await screen.findByRole( 'heading', { name: 'Your games' } );
		expect( apiValue.catalog ).toHaveBeenCalledTimes( 2 );

	} );

	it( 'locks a running generation stage and clears busy when it resolves', async () => {

		let release;
		const generated = new Promise( ( resolve ) => { release = resolve; } );
		const made = make( api( { generateCity: vi.fn().mockReturnValue( generated ) } ) );
		await made.app.start();
		const user = userEvent.setup();
		await user.click( screen.getByRole( 'button', { name: 'New game' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Generate city' } ) );
		expect( screen.getByRole( 'button', { name: 'Generate city' } ).disabled ).toBe( true );
		expect( screen.getByText( 'Working on this stage.' ) ).toBeTruthy();
		release( { city } );
		await screen.findByRole( 'heading', { name: 'Playable interiors' } );

	} );

	it( 'shows generation failures in the wizard and clears the busy state', async () => {

		const made = make( api( { generateCity: vi.fn().mockRejectedValue( new Error( 'atlas refused the seed' ) ) } ) );
		await made.app.start();
		const user = userEvent.setup();
		await user.click( screen.getByRole( 'button', { name: 'New game' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Generate city' } ) );
		await waitFor( () => expect( screen.getByRole( 'alert' ).textContent ).toContain( 'atlas refused the seed' ) );
		expect( screen.getByRole( 'button', { name: 'Generate city' } ).disabled ).toBe( false );

	} );

	it( 'parses a local game file before import and renders the returned catalog', async () => {

		const made = make();
		await made.app.start();
		const file = new File( [ JSON.stringify( { contractVersion: '1.0.0', game: 'rain' } ) ], 'rain.urbegame.json', { type: 'application/json' } );
		await userEvent.setup().upload( made.app.view.file, file );
		await waitFor( () => expect( made.api.importGame ).toHaveBeenCalledWith( { contractVersion: '1.0.0', game: 'rain' } ) );
		expect( screen.getByRole( 'heading', { name: 'Salt Wharf' } ) ).toBeTruthy();

	} );

	it( 'rejects malformed local JSON before it reaches the API', async () => {

		const made = make();
		await made.app.start();
		const file = new File( [ '{broken' ], 'broken.json', { type: 'application/json' } );
		await userEvent.setup().upload( made.app.view.file, file );
		await waitFor( () => expect( screen.getByRole( 'alert' ).textContent ).toContain( 'Could not load the game file' ) );
		expect( made.api.importGame ).not.toHaveBeenCalled();

	} );

	it( 'downloads game and city documents with stable filenames', async () => {

		const made = make( api( { catalog: vi.fn().mockResolvedValue( { games: [ game ], cities: [ city ] } ) } ) );
		await made.app.start();
		const user = userEvent.setup();
		await user.click( screen.getByRole( 'button', { name: 'Save copy' } ) );
		await waitFor( () => expect( made.download ).toHaveBeenCalledWith( 'rain-game.urbegame.json', { kind: 'game' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Cities' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Export city' } ) );
		await waitFor( () => expect( made.download ).toHaveBeenCalledWith( 'rain-city.urbecity.json', { kind: 'city' } ) );

	} );

	it( 'fails closed on an invalid continue response', async () => {

		const made = make( api( {
			catalog: vi.fn().mockResolvedValue( { games: [ game ], cities: [] } ),
			continueGame: vi.fn().mockResolvedValue( { playUrl: '' } )
		} ) );
		await made.app.start();
		await userEvent.setup().click( screen.getByRole( 'button', { name: 'Continue game' } ) );
		await waitFor( () => expect( screen.getByRole( 'alert' ).textContent ).toContain( 'playUrl' ) );
		expect( made.navigate ).not.toHaveBeenCalled();

	} );

	it( 'rejects an incomplete API before mounting', () => {

		expect( () => new LauncherApp( { mount: document.body, api: { catalog: vi.fn() } } ) ).toThrow( 'continueGame' );
		expect( document.body.children ).toHaveLength( 0 );

	} );

} );
