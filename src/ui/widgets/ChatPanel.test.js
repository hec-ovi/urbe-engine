// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import Ajv from 'ajv/dist/2020.js';
import layout from './chat-layout.json' with { type: 'json' };
import schema from './chat-layout.schema.json' with { type: 'json' };
import { ChatPanel } from './ChatPanel.js';

const ADA = { name: 'Ada Vance', role: 'office worker' };

const STORY = { title: 'The missing report', objective: 'Hear Ada out about the report.' };
const CHOICES = [
	{ id: 'ask', text: 'Who needs the report?', value: { questId: 'report', stepId: 'meet', choiceId: 'ask' } },
	{ id: 'accept', text: 'I will get the report.', hint: 'Accept Ada’s request', value: { questId: 'report', stepId: 'meet', choiceId: 'accept' } }
];

describe( 'ChatPanel', () => {

	let panel, onSend, onClose, onChoice, onTopic, onAction, onRetry, onJournal;

	beforeEach( () => {

		onSend = vi.fn();
		onClose = vi.fn();
		onChoice = vi.fn();
		onTopic = vi.fn();
		onAction = vi.fn();
		onRetry = vi.fn();
		onJournal = vi.fn();
		panel = new ChatPanel( { onSend, onClose, onChoice, onTopic, onAction, onRetry, onJournal } );
		document.body.replaceChildren( panel.element );
		panel.show( ADA );

	} );

	it( 'reads its labels from a layout that meets its schema', () => {

		const validate = new Ajv( { allErrors: true, strict: true } ).compile( schema );
		expect( validate( layout ), JSON.stringify( validate.errors ) ).toBe( true );

	} );

	it( 'opens an accessible conversation named as it is told, with the role only when given', () => {

		expect( screen.getByRole( 'dialog', { name: 'Ada Vance' } ) ).toBeTruthy();
		expect( screen.getByRole( 'heading', { name: 'Ada Vance' } ) ).toBeTruthy();
		expect( screen.getByText( 'office worker' ) ).toBeTruthy();
		expect( screen.getByRole( 'log', { name: 'Conversation' } ).getAttribute( 'aria-live' ) ).toBe( 'polite' );
		expect( screen.queryByRole( 'button', { name: 'Open journal' } ) ).toBeNull();
		expect( document.activeElement ).toBe( screen.getByRole( 'textbox', { name: 'say something' } ) );
		expect( screen.getByRole( 'textbox' ).placeholder ).toBe( 'Say anything to Ada Vance' );
		expect( screen.getByText( 'Free talk' ) ).toBeTruthy();
		panel.show( { name: 'Someone passing by' } );
		expect( screen.getByRole( 'dialog', { name: 'Someone passing by' } ) ).toBeTruthy();
		expect( panel.role.hidden ).toBe( true );

	} );

	it( 'puts messages on their own side and sends trimmed free text once through button or Enter, never blanks', async () => {

		const user = userEvent.setup();
		panel.addMessage( { from: 'npc', name: 'Ada', text: 'Down the steps.' } );
		panel.addMessage( { from: 'player', text: 'Got it.' } );
		expect( screen.getByText( 'Down the steps.' ).closest( '.chat-line' ).classList.contains( 'is-npc' ) ).toBe( true );
		expect( screen.getByText( 'Got it.' ).closest( '.chat-line' ).classList.contains( 'is-player' ) ).toBe( true );
		expect( within( screen.getByRole( 'log' ) ).getByText( 'You' ) ).toBeTruthy();
		panel.setTranscript( [] );
		expect( panel.transcript.children ).toHaveLength( 0 );
		const input = screen.getByRole( 'textbox', { name: 'say something' } );
		await user.type( input, '  where is the quay?  ' );
		await user.click( screen.getByRole( 'button', { name: 'send' } ) );
		await user.type( input, 'thanks{Enter}' );
		await user.type( input, '   {Enter}' );
		await user.click( screen.getByRole( 'button', { name: 'send' } ) );
		expect( onSend.mock.calls ).toEqual( [ [ 'where is the quay?' ], [ 'thanks' ] ] );
		expect( onChoice ).not.toHaveBeenCalled();

	} );

	it( 'streams a line as it arrives, finishes or discards it, and ignores calls on a line that is done', () => {

		const log = screen.getByRole( 'log' );
		const reply = panel.beginMessage( { from: 'npc', name: 'Ada' } );
		reply.update( 'Down the ' );
		expect( log.getAttribute( 'aria-busy' ) ).toBe( 'true' );
		expect( reply.line.classList.contains( 'is-streaming' ) ).toBe( true );
		reply.update( 'Down the steps.' );
		reply.finish();
		reply.update( 'Down the steps. Ignored.' );
		reply.discard();
		expect( within( log ).getByText( 'Down the steps.' ).closest( '.chat-line' ) ).toBe( reply.line );
		expect( reply.line.classList.contains( 'is-streaming' ) ).toBe( false );
		expect( log.getAttribute( 'aria-busy' ) ).toBe( 'false' );

		const failed = panel.beginMessage( { from: 'npc', name: 'Ada' } );
		failed.update( 'Half a' );
		failed.discard();
		failed.update( 'Half a sentence.' );
		expect( panel.transcript.children ).toHaveLength( 1 );
		expect( log.getAttribute( 'aria-busy' ) ).toBe( 'false' );

		const overtaken = panel.beginMessage( { from: 'npc', name: 'Ada' } );
		panel.show( { name: 'Kip Thorn' } );
		overtaken.update( 'Too late.' );
		overtaken.finish();
		expect( panel.transcript.children ).toHaveLength( 0 );
		expect( log.getAttribute( 'aria-busy' ) ).toBe( 'false' );

	} );

	it( 'gives the composer its focus back after a pending line unless the player moved on', () => {

		const input = screen.getByRole( 'textbox', { name: 'say something' } );
		panel.setSending( true );
		expect( document.activeElement ).toBe( screen.getByRole( 'button', { name: 'End conversation' } ) );
		panel.setSending( false );
		expect( document.activeElement ).toBe( input );
		panel.setSending( true );
		screen.getByRole( 'button', { name: 'close' } ).focus();
		panel.setSending( false );
		expect( document.activeElement ).toBe( screen.getByRole( 'button', { name: 'close' } ) );

	} );

	it( 'tags lines of the story and of free talk, leaving the text as it is', () => {

		const greeting = panel.addMessage( { from: 'npc', name: 'Ada', text: 'Hello.' } );
		const opening = panel.addMessage( { from: 'npc', name: 'Ada', text: 'The report is gone.', kind: 'story' } );
		const typed = panel.addMessage( { from: 'player', text: 'What report?', kind: 'talk' } );
		const reply = panel.beginMessage( { from: 'npc', name: 'Ada', kind: 'talk' } );
		expect( [ greeting, opening, typed, reply.line ].map( ( line ) => line.dataset.tag ) ).toEqual( [ undefined, 'story', 'free talk', 'free talk' ] );
		expect( opening.textContent ).toBe( 'AdaThe report is gone.' );

	} );

	it( 'returns each shown line and marks how it is voiced only while it is shown', () => {

		const line = panel.addMessage( { from: 'npc', name: 'Ada', text: 'Down the steps.' } );
		expect( line.textContent ).toBe( 'AdaDown the steps.' );
		expect( panel.setSpeaking( line, 'pending' ) ).toBe( true );
		expect( line.dataset.speaking ).toBe( 'pending' );
		panel.setSpeaking( line, 'playing' );
		expect( line.dataset.speaking ).toBe( 'playing' );
		panel.setSpeaking( line, 'idle' );
		expect( 'speaking' in line.dataset ).toBe( false );
		expect( () => panel.setSpeaking( line, 'loud' ) ).toThrow( 'unknown speaking state: loud' );
		panel.setTranscript( [] );
		expect( panel.setSpeaking( line, 'playing' ) ).toBe( false );
		expect( panel.setSpeaking( null, 'playing' ) ).toBe( false );
		expect( 'speaking' in line.dataset ).toBe( false );

	} );

	it( 'offers asking along apart from story replies, folded while replies are offered, and reports only their ids', async () => {

		const user = userEvent.setup();
		panel.setActions( [ { id: 'follow', label: 'Bring Ada along' }, { id: 'lead:p9', label: 'Go with Ada to the Blue Lantern' } ] );
		expect( panel.asks.open ).toBe( true );
		panel.setChoices( CHOICES );
		expect( panel.asks.open ).toBe( false );
		await user.click( screen.getByText( 'Ask Ada Vance along' ) );
		expect( panel.asks.open ).toBe( true );
		panel.setChoices( CHOICES );
		expect( panel.asks.open ).toBe( true );
		const actions = within( screen.getByRole( 'group', { name: 'Ask Ada Vance along' } ) );
		expect( actions.getAllByRole( 'button' ).map( ( button ) => button.dataset.action ) ).toEqual( [ 'follow', 'lead:p9' ] );
		await user.click( actions.getByRole( 'button', { name: 'Go with Ada to the Blue Lantern' } ) );
		expect( onAction ).toHaveBeenCalledExactlyOnceWith( 'lead:p9' );
		expect( onChoice ).not.toHaveBeenCalled();
		panel.setChoices( [] );
		actions.getByRole( 'button', { name: 'Bring Ada along' } ).focus();
		panel.setActions( [] );
		expect( screen.queryByRole( 'group', { name: 'Ask Ada Vance along' } ) ).toBeNull();
		expect( document.activeElement ).toBe( screen.getByRole( 'textbox', { name: 'say something' } ) );

	} );

	it( 'withdraws free chat with a note saying why, and offers it again in the next conversation', () => {

		panel.setFreeChat( false, 'This passer-by has no time to chat.' );
		expect( screen.queryByRole( 'textbox' ) ).toBeNull();
		expect( screen.getByText( 'This passer-by has no time to chat.' ) ).toBeTruthy();
		expect( document.activeElement ).toBe( screen.getByRole( 'button', { name: 'End conversation' } ) );
		panel.show( ADA );
		expect( screen.queryByText( 'This passer-by has no time to chat.' ) ).toBeNull();
		expect( document.activeElement ).toBe( screen.getByRole( 'textbox', { name: 'say something' } ) );

	} );

	it( 'shows the story and accessible replies, dispatching their exact identities independently of free chat', async () => {

		panel.setStory( STORY );
		panel.setChoices( CHOICES, true );
		expect( screen.getByText( STORY.title ) ).toBeTruthy();
		expect( screen.getByText( STORY.objective ).previousElementSibling.textContent ).toBe( 'Your goal' );
		const replies = within( screen.getByRole( 'group', { name: 'Story replies' } ) );
		const first = replies.getByRole( 'button', { name: 'Who needs the report?' } );
		expect( document.activeElement ).toBe( first );
		const user = userEvent.setup();
		await user.keyboard( '{Enter}' );
		expect( onChoice ).toHaveBeenCalledExactlyOnceWith( CHOICES[ 0 ].value );
		await user.click( replies.getByRole( 'button', { name: /I will get the report/ } ) );
		expect( onChoice.mock.calls ).toEqual( [ [ CHOICES[ 0 ].value ], [ CHOICES[ 1 ].value ] ] );
		// A number key picks that reply, except while the text box is in use.
		await user.keyboard( '2' );
		expect( onChoice.mock.calls.at( - 1 ) ).toEqual( [ CHOICES[ 1 ].value ] );
		await user.click( screen.getByRole( 'textbox' ) );
		await user.keyboard( '1' );
		expect( onChoice ).toHaveBeenCalledTimes( 3 );
		expect( screen.getByRole( 'textbox' ).value ).toBe( '1' );
		expect( onSend ).not.toHaveBeenCalled();
		await user.click( screen.getByRole( 'button', { name: 'Open journal' } ) );
		expect( onJournal ).toHaveBeenCalledTimes( 1 );

	} );

	it( 'does not dispatch disabled choices and focuses End conversation when every reply is unavailable', async () => {

		panel.setChoices( CHOICES.map( choice => ( { ...choice, disabled: true, hint: 'Ada returns at 18:00.' } ) ), true );
		expect( document.activeElement ).toBe( screen.getByRole( 'button', { name: 'End conversation' } ) );
		const unavailable = screen.getByRole( 'button', { name: /Who needs the report/ } );
		expect( unavailable.disabled ).toBe( true );
		await userEvent.setup().click( unavailable );
		expect( onChoice ).not.toHaveBeenCalled();
		panel.setChoices( [ { id: 'later', text: 'I will come back later.' } ], true );
		await userEvent.setup().keyboard( ' ' );
		expect( onChoice ).toHaveBeenCalledExactlyOnceWith( 'later' );

	} );

	it( 'keeps story replies usable while free chat is pending, then presents a retryable failure without erasing history', async () => {

		panel.setChoices( CHOICES );
		panel.addMessage( { from: 'player', text: 'Where did Ada go?' } );
		panel.setSending( true );
		panel.setStatus( 'Waiting for a reply…' );
		expect( screen.getByRole( 'textbox' ).disabled ).toBe( true );
		expect( screen.getByRole( 'button', { name: 'send' } ).disabled ).toBe( true );
		expect( panel.compose.getAttribute( 'aria-busy' ) ).toBe( 'true' );
		expect( screen.getByRole( 'status' ).textContent ).toBe( 'Waiting for a reply…' );
		const user = userEvent.setup();
		await user.type( screen.getByRole( 'textbox' ), 'another request{Enter}' );
		await user.click( screen.getByRole( 'button', { name: 'send' } ) );
		expect( onSend ).not.toHaveBeenCalled();
		await user.click( screen.getByRole( 'button', { name: /Who needs the report/ } ) );
		expect( onChoice ).toHaveBeenCalledExactlyOnceWith( CHOICES[ 0 ].value );

		panel.setSending( false );
		panel.setStatus( 'The reply could not be loaded. Try again.', { error: true, retry: true } );
		expect( screen.getByRole( 'textbox' ).disabled ).toBe( false );
		expect( screen.getByText( 'Where did Ada go?' ) ).toBeTruthy();
		await user.click( screen.getByRole( 'button', { name: 'Retry reply' } ) );
		expect( onRetry ).toHaveBeenCalledTimes( 1 );
		expect( onSend ).not.toHaveBeenCalled();
		panel.setStatus( '' );
		expect( screen.queryByRole( 'button', { name: 'Retry reply' } ) ).toBeNull();

	} );

	it( 'selects topics by their payload and does not turn inspection into a quest reply', async () => {

		const first = { key: 'report', title: 'The missing report', value: { questId: 'report', stepId: 'meet' } };
		const second = { key: 'cups', title: 'The cups', value: { questId: 'cups', stepId: 'ask' } };
		panel.setTopics( [ first, second ], first.key );
		expect( screen.getByRole( 'button', { name: first.title } ).getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		await userEvent.setup().click( screen.getByRole( 'button', { name: second.title } ) );
		expect( onTopic ).toHaveBeenCalledExactlyOnceWith( second.value );
		expect( onChoice ).not.toHaveBeenCalled();
		expect( onSend ).not.toHaveBeenCalled();
		panel.setTopics( [ first ], first.key );
		expect( screen.queryByRole( 'button', { name: first.title } ) ).toBeNull();

	} );

	it( 'contains keyboard focus and reports Escape, the header close, and End conversation once without sending or choosing', async () => {

		panel.setStory( STORY );
		panel.setChoices( CHOICES, true );
		const user = userEvent.setup();
		const close = screen.getByRole( 'button', { name: 'close' } );
		const end = screen.getByRole( 'button', { name: 'End conversation' } );
		end.focus();
		await user.tab();
		expect( document.activeElement ).toBe( close );
		await user.tab( { shift: true } );
		expect( document.activeElement ).toBe( end );
		panel.setChoices( CHOICES, true );
		const bubbled = vi.fn();
		document.addEventListener( 'keydown', bubbled );
		await user.keyboard( '{Escape}' );
		document.removeEventListener( 'keydown', bubbled );
		expect( bubbled ).not.toHaveBeenCalled();
		expect( onClose ).toHaveBeenCalledTimes( 1 );
		await user.click( close );
		await user.click( end );
		expect( onClose ).toHaveBeenCalledTimes( 3 );
		expect( onChoice ).not.toHaveBeenCalled();
		expect( onSend ).not.toHaveBeenCalled();
		panel.show( null );
		expect( screen.queryByRole( 'dialog' ) ).toBeNull();

	} );

	it( 'keeps static transcript clicks inside the dialog for Escape and keyboard navigation', async () => {

		panel.addMessage( { from: 'npc', text: 'Read this reply before deciding.' } );
		const reply = screen.getByText( 'Read this reply before deciding.' );
		const user = userEvent.setup();
		await user.click( reply );
		expect( document.activeElement ).toBe( panel.element );
		await user.tab();
		expect( document.activeElement ).toBe( screen.getByRole( 'button', { name: 'close' } ) );
		await user.click( reply );
		await user.tab( { shift: true } );
		expect( document.activeElement ).toBe( screen.getByRole( 'button', { name: 'End conversation' } ) );
		await user.click( reply );
		await user.keyboard( '{Escape}' );
		expect( onClose ).toHaveBeenCalledOnce();

	} );

	it( 'starts the next conversation with fresh content and enabled controls after a pending failed conversation', () => {

		panel.setStory( STORY );
		panel.setChoices( CHOICES );
		panel.setTopics( [ { key: 'report', title: 'The report', value: 'report' } ] );
		panel.setActions( [ { id: 'follow', label: 'Bring Ada along' } ] );
		panel.addMessage( { from: 'npc', text: 'The old conversation.' } );
		panel.setStatus( 'Old failure', { error: true, retry: true } );
		panel.setSending( true );
		panel.input.value = 'old draft';
		panel.show( { name: 'Kip Thorn', role: 'vendor' } );
		expect( screen.getByRole( 'dialog', { name: 'Kip Thorn' } ) ).toBeTruthy();
		expect( screen.getByText( 'vendor' ) ).toBeTruthy();
		expect( screen.queryByText( 'The old conversation.' ) ).toBeNull();
		expect( screen.queryByRole( 'group', { name: 'Story replies' } ) ).toBeNull();
		expect( screen.queryByRole( 'group', { name: 'Ask Kip Thorn along' } ) ).toBeNull();
		expect( screen.queryByRole( 'button', { name: 'Retry reply' } ) ).toBeNull();
		expect( screen.queryByRole( 'button', { name: 'The report' } ) ).toBeNull();
		expect( screen.getByRole( 'textbox' ).value ).toBe( '' );
		expect( screen.getByRole( 'textbox' ).disabled ).toBe( false );
		expect( document.activeElement ).toBe( screen.getByRole( 'textbox' ) );

	} );

} );
