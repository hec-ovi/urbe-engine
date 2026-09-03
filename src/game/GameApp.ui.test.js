// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { stubCanvas } from '../ui/test-helpers/canvas.js';
import { GameApp } from './GameApp.js';

describe( 'playable game navigation', () => {

	beforeEach( () => {

		document.body.replaceChildren();
		stubCanvas();

	} );

	it( 'returns a direct preview to the real launcher from the Leave control', async () => {

		const navigate = vi.fn();
		const app = new GameApp( {}, { navigate } );
		app.view.setPaused( true );

		await userEvent.setup().click( screen.getByRole( 'button', { name: /leave/i } ) );

		expect( navigate ).toHaveBeenCalledOnce();
		expect( navigate ).toHaveBeenCalledWith( '/' );

	} );

	it( 'sends a typed line and renders the NPC reply through the dialogue lifecycle', async () => {

		const app = dialogueApp();
		const user = userEvent.setup();
		await user.type( screen.getByRole( 'textbox', { name: 'say something' } ), 'where is the quay?{Enter}' );

		await vi.waitFor( () => expect( app.talk.say ).toHaveBeenCalledOnce() );
		expect( app.talk.say ).toHaveBeenCalledWith( app.interactor.conversation, 'where is the quay?', 725, [] );
		expect( screen.getByText( 'Down the steps.' ) ).toBeTruthy();
		expect( app.animations.playerDialogueTurn ).toHaveBeenCalledOnce();
		expect( app.animations.npcDialogueTurn ).toHaveBeenCalledOnce();
		expect( app.animations.completeDialogueTurn ).toHaveBeenCalledOnce();

	} );

	it( 'renders the structured NPC name in the conversation avatar', () => {

		const app = new GameApp( {} );
		app.input = { exitLock: vi.fn() };

		app.presentConversation( {
			instance: {
				name: { given: 'Ada', family: 'Vance' }, type: 'clerk',
				home: { parcelId: 'p1', unit: 2 }, routine: []
			}
		} );

		expect( document.querySelector( '.avatar-name' ).textContent ).toBe( 'Ada Vance' );
		expect( app.input.exitLock ).toHaveBeenCalledOnce();

	} );

	it( 'keeps typed chat usable after a text model failure', async () => {

		const app = dialogueApp();
		app.talk.say.mockRejectedValueOnce( new Error( 'model unavailable' ) );
		const user = userEvent.setup();
		const input = screen.getByRole( 'textbox', { name: 'say something' } );

		await user.type( input, 'first line{Enter}' );
		await vi.waitFor( () => expect( screen.getByText( '...' ) ).toBeTruthy() );
		expect( app.animations.completeDialogueTurn ).toHaveBeenCalledOnce();

		await user.type( input, 'second line{Enter}' );
		await vi.waitFor( () => expect( app.talk.say ).toHaveBeenCalledTimes( 2 ) );
		expect( input.disabled ).toBe( false );
		expect( screen.getByText( 'Down the steps.' ) ).toBeTruthy();

	} );

	it( 'ignores a model reply that arrives after the conversation closes', async () => {

		let finishReply;
		const app = dialogueApp();
		app.talk.say.mockReturnValue( new Promise( ( resolve ) => { finishReply = resolve; } ) );
		const user = userEvent.setup();

		await user.type( screen.getByRole( 'textbox', { name: 'say something' } ), 'wait{Enter}' );
		await vi.waitFor( () => expect( app.talk.say ).toHaveBeenCalledOnce() );
		await user.click( screen.getByRole( 'button', { name: 'close' } ) );
		finishReply( 'Too late.' );
		await Promise.resolve();

		expect( screen.queryByText( 'Too late.' ) ).toBeNull();

	} );

} );

function dialogueApp() {

	const app = new GameApp( {} );
	const conversation = {
		npcId: 'npc-ada',
		instance: {
			npcId: 'npc-ada', name: { given: 'Ada', family: 'Vance' }, type: 'clerk',
			home: { parcelId: 'p1', unit: 2 }, routine: []
		},
		behavior: null
	};
	app.clock = { timeMin: 725 };
	app.quests = { snapshot: () => [] };
	app.animations = {
		playerDialogueTurn: vi.fn(), npcDialogueTurn: vi.fn(), completeDialogueTurn: vi.fn()
	};
	app.talk = { say: vi.fn( async () => 'Down the steps.' ) };
	app.interactor = {
		conversation,
		close: vi.fn( () => { app.interactor.conversation = null; } )
	};
	app.view.dialog.show( conversation );
	return app;

}
