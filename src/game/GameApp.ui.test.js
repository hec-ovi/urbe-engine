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

	it( 'ties NPC speaking animation to audible playback and settles it at audio end', async () => {

		let finishPlayback;
		const playback = new Promise( ( resolve ) => { finishPlayback = resolve; } );
		const speech = speechPort();
		speech.speak.mockImplementation( async ( _conversation, _text, lifecycle ) => {

			lifecycle.onPlaybackStart();
			await playback;
			lifecycle.onPlaybackEnd();

		} );
		const app = dialogueApp( speech );
		const user = userEvent.setup();
		await user.type( screen.getByRole( 'textbox', { name: 'say something' } ), 'where is the quay?{Enter}' );

		await vi.waitFor( () => expect( speech.speak ).toHaveBeenCalledOnce() );
		expect( speech.unlock.mock.invocationCallOrder[ 0 ] ).toBeLessThan( app.talk.say.mock.invocationCallOrder[ 0 ] );
		expect( screen.getByText( 'Down the steps.' ) ).toBeTruthy();
		expect( app.animations.npcDialogueTurn ).toHaveBeenCalledOnce();
		expect( app.animations.completeDialogueTurn ).toHaveBeenCalledTimes( 2 );

		finishPlayback();
		await vi.waitFor( () => expect( app.animations.completeDialogueTurn ).toHaveBeenCalledTimes( 3 ) );

	} );

	it( 'sends microphone transcription through the same dialogue path and cancels on close', async () => {

		const speech = speechPort();
		speech.stopTranscription.mockResolvedValue( { text: 'spoken question' } );
		speech.speak.mockImplementation( async ( _conversation, _text, lifecycle ) => {

			lifecycle.onPlaybackStart();
			lifecycle.onPlaybackEnd();

		} );
		const app = dialogueApp( speech );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'start voice input' } ) );
		await vi.waitFor( () => expect( screen.getByRole( 'button', { name: 'stop voice input' } ) ).toBeTruthy() );
		expect( speech.unlock.mock.invocationCallOrder[ 0 ] ).toBeLessThan(
			speech.startTranscription.mock.invocationCallOrder[ 0 ]
		);
		await user.click( screen.getByRole( 'button', { name: 'stop voice input' } ) );
		await vi.waitFor( () => expect( app.talk.say ).toHaveBeenCalledWith(
			app.interactor.conversation, 'spoken question', 725, []
		) );

		await user.click( screen.getByRole( 'button', { name: 'close' } ) );
		expect( speech.cancel ).toHaveBeenLastCalledWith( 'player-left' );
		expect( speech.cancelTranscription ).toHaveBeenCalled();

	} );

	it( 'settles a failed voice turn and keeps typed chat usable', async () => {

		const speech = speechPort();
		speech.speak.mockRejectedValue( new Error( 'model unavailable' ) );
		const app = dialogueApp( speech );
		const user = userEvent.setup();
		const input = screen.getByRole( 'textbox', { name: 'say something' } );

		await user.type( input, 'first line{Enter}' );
		await vi.waitFor( () => expect( screen.getByText( 'model unavailable' ) ).toBeTruthy() );
		expect( app.animations.completeDialogueTurn ).toHaveBeenCalledTimes( 3 );

		await user.type( input, 'second line{Enter}' );
		await vi.waitFor( () => expect( app.talk.say ).toHaveBeenCalledTimes( 2 ) );
		expect( input.disabled ).toBe( false );
		expect( speech.cancel ).toHaveBeenCalledWith( 'new-line' );

	} );

	it( 'keeps microphone UI off when permission finishes after the conversation closes', async () => {

		let finishPermission;
		const speech = speechPort();
		speech.startTranscription.mockReturnValue( new Promise( ( resolve ) => { finishPermission = resolve; } ) );
		const app = dialogueApp( speech );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'start voice input' } ) );
		await user.click( screen.getByRole( 'button', { name: 'close' } ) );
		finishPermission( false );
		await Promise.resolve();

		expect( app.view.dialog.record.getAttribute( 'aria-pressed' ) ).toBe( 'false' );
		expect( speech.cancelTranscription ).toHaveBeenCalled();

	} );

} );

function dialogueApp( speech ) {

	const app = new GameApp( {} );
	const conversation = {
		npcId: 'npc-ada',
		instance: {
			npcId: 'npc-ada', name: { given: 'Ada', family: 'Vance' }, type: 'clerk',
			home: { parcelId: 'p1', unit: 2 }, routine: []
		},
		behavior: null
	};
	app.speech = speech;
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

function speechPort() {

	return {
		unlock: vi.fn( async () => {} ), cancel: vi.fn(),
		cancelTranscription: vi.fn(), startTranscription: vi.fn( async () => true ),
		stopTranscription: vi.fn(), speak: vi.fn()
	};

}
