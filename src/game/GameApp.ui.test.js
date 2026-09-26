// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { stubCanvas } from '../ui/test-helpers/canvas.js';
import { GameApp } from './GameApp.js';
import { replyEvents, talkError, talkStream } from './talk/talk.test-fixtures.js';

describe( 'playable game navigation', () => {

	beforeEach( () => {

		document.body.replaceChildren();
		stubCanvas();

	} );

	afterEach( () => {

		vi.useRealTimers();
		vi.restoreAllMocks();

	} );

	it( 'returns a direct preview to the real launcher from the Leave control', async () => {

		const navigate = vi.fn();
		const app = new GameApp( {}, { navigate } );
		app.view.setPaused( true );

		await userEvent.setup().click( screen.getByRole( 'button', { name: /leave/i } ) );

		expect( navigate ).toHaveBeenCalledOnce();
		expect( navigate ).toHaveBeenCalledWith( '/' );

	} );

	it( 'sends a typed line, renders the reply through the dialogue lifecycle, and stays usable after a model failure', async () => {

		const app = dialogueApp();
		const user = userEvent.setup();
		const input = screen.getByRole( 'textbox', { name: 'say something' } );
		await user.type( input, 'where is the quay?{Enter}' );

		await vi.waitFor( () => expect( screen.getByText( 'Down the steps.' ) ).toBeTruthy() );
		expect( app.talk.stream ).toHaveBeenCalledExactlyOnceWith( app.interactor.conversation, 'where is the quay?', 725, [], { signal: expect.any( AbortSignal ) } );
		expect( app.animations.playerDialogueTurn ).toHaveBeenCalledOnce();
		expect( app.animations.npcDialogueTurn ).toHaveBeenCalledOnce();
		expect( app.animations.completeDialogueTurn ).not.toHaveBeenCalled();
		expect( app.questGameplay.places ).not.toHaveBeenCalled();

		app.talk.stream.mockImplementationOnce( () => talkStream( [], talkError( 'model unavailable', 502 ) ) );
		await user.type( input, 'second line{Enter}' );
		await vi.waitFor( () => expect( screen.getByText( /reply could not be reached/ ) ).toBeTruthy() );
		expect( app.animations.completeDialogueTurn ).toHaveBeenCalledOnce();

		await user.type( input, 'third line{Enter}' );
		await vi.waitFor( () => expect( screen.getAllByText( 'Down the steps.' ) ).toHaveLength( 2 ) );
		expect( app.talk.stream ).toHaveBeenCalledTimes( 3 );
		expect( input.disabled ).toBe( false );

	} );

	it( 'gives up a reply that goes quiet, leaving no part of it and offering Retry', async () => {

		vi.useFakeTimers();
		const app = dialogueApp();
		app.talk.stream.mockImplementationOnce( ( conversation, line, timeMin, quests, { signal } ) => talkStream( [
			{ type: 'delta', text: 'Down the' },
			new Promise( ( resolve, reject ) => signal.addEventListener( 'abort', () => reject( signal.reason ) ) )
		] ) );
		const said = app.sayLine( 'where is the quay?' );
		await vi.advanceTimersByTimeAsync( 1000 );
		expect( app.view.dialog.transcript.lastElementChild.textContent ).toBe( 'Ada VanceDown the' );
		await vi.advanceTimersByTimeAsync( 90000 );
		await said;
		expect( [ ...app.view.dialog.transcript.children ].map( ( line ) => line.textContent ) ).toEqual( [ 'Youwhere is the quay?' ] );
		expect( screen.getByRole( 'button', { name: 'Retry reply' } ) ).toBeTruthy();
		expect( console.warn ).toHaveBeenCalledWith( 'talk:', 'no reply for 90 s' );

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
	app.questGameplay = { places: vi.fn( () => [] ) };
	app.animations = {
		playerDialogueTurn: vi.fn(), npcDialogueTurn: vi.fn(), completeDialogueTurn: vi.fn()
	};
	app.talk = { stream: vi.fn( () => talkStream( replyEvents( 'Down the ', 'steps.' ) ) ) };
	app.interactor = {
		conversation,
		close: vi.fn( () => { app.interactor.conversation = null; } )
	};
	app.view.dialog.show( { name: 'Ada Vance' } );
	vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
	return app;

}
