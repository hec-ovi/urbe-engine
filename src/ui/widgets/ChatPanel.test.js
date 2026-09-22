// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { ChatPanel } from './ChatPanel.js';

const CONVERSATION = {
	instance: {
		npcId: 'n1',
		name: { given: 'Ada', family: 'Vance' },
		type: 'quest_office_worker',
		home: { parcelId: 'p12', unit: 3 },
		job: { parcelId: 'p40', role: 'clerk', shift: { startMin: 540, endMin: 1020, kind: 'day' } },
		routine: Array.from( { length: 120 }, ( _, index ) => ( {
			days: [ index % 7 ], startMin: 540, endMin: 1020,
			activity: 'working', place: { kind: 'parcel', id: `diagnostic-parcel-${index}` }
		} ) )
	},
	behavior: { activity: 'working', mode: 'indoors', place: { kind: 'parcel', id: 'p40' }, interrupted: true }
};

const STORY = { title: 'The missing report', objective: 'Hear Ada out about the report.' };
const CHOICES = [
	{ id: 'ask', text: 'Who needs the report?', value: { questId: 'report', stepId: 'meet', choiceId: 'ask' } },
	{ id: 'accept', text: 'I will get the report.', hint: 'Accept Ada’s request', value: { questId: 'report', stepId: 'meet', choiceId: 'accept' } }
];

describe( 'ChatPanel', () => {

	let panel, onSend, onClose, onChoice, onTopic, onRetry, onJournal;

	beforeEach( () => {

		onSend = vi.fn();
		onClose = vi.fn();
		onChoice = vi.fn();
		onTopic = vi.fn();
		onRetry = vi.fn();
		onJournal = vi.fn();
		panel = new ChatPanel( { onSend, onClose, onChoice, onTopic, onRetry, onJournal } );
		document.body.replaceChildren( panel.element );
		panel.show( CONVERSATION );

	} );

	it( 'opens an accessible named conversation without exposing even a long simulation schedule', () => {

		expect( screen.getByRole( 'dialog', { name: 'Ada Vance' } ) ).toBeTruthy();
		expect( screen.getByRole( 'heading', { name: 'Ada Vance' } ) ).toBeTruthy();
		expect( screen.getByText( 'office worker' ) ).toBeTruthy();
		expect( panel.element.textContent ).not.toMatch( /diagnostic-parcel|p12|p40|paused for you|quest_office_worker|09:00/ );
		expect( panel.element.querySelector( '.chat-profile' ) ).toBeNull();
		expect( screen.getByRole( 'log', { name: 'Conversation' } ).getAttribute( 'aria-live' ) ).toBe( 'polite' );
		expect( screen.queryByRole( 'button', { name: 'Open journal' } ) ).toBeNull();
		expect( document.activeElement ).toBe( screen.getByRole( 'textbox', { name: 'say something' } ) );
		panel.show( { instance: null } );
		expect( screen.getByRole( 'dialog', { name: 'Someone passing by' } ) ).toBeTruthy();

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

	it( 'shows the story and accessible replies, dispatching their exact identities independently of free chat', async () => {

		panel.setStory( STORY );
		panel.setChoices( CHOICES, true );
		expect( screen.getByText( STORY.title ) ).toBeTruthy();
		expect( screen.getByText( STORY.objective ) ).toBeTruthy();
		const replies = within( screen.getByRole( 'group', { name: 'Your replies' } ) );
		const first = replies.getByRole( 'button', { name: 'Who needs the report?' } );
		expect( document.activeElement ).toBe( first );
		const user = userEvent.setup();
		await user.keyboard( '{Enter}' );
		expect( onChoice ).toHaveBeenCalledExactlyOnceWith( CHOICES[ 0 ].value );
		await user.click( replies.getByRole( 'button', { name: /I will get the report/ } ) );
		expect( onChoice.mock.calls ).toEqual( [ [ CHOICES[ 0 ].value ], [ CHOICES[ 1 ].value ] ] );
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
		panel.addMessage( { from: 'npc', text: 'The old conversation.' } );
		panel.setStatus( 'Old failure', { error: true, retry: true } );
		panel.setSending( true );
		panel.input.value = 'old draft';
		panel.show( { instance: { name: { given: 'Kip', family: 'Thorn' }, type: 'quest_vendor' } } );
		expect( screen.getByRole( 'dialog', { name: 'Kip Thorn' } ) ).toBeTruthy();
		expect( screen.getByText( 'vendor' ) ).toBeTruthy();
		expect( screen.queryByText( 'The old conversation.' ) ).toBeNull();
		expect( screen.queryByRole( 'group', { name: 'Your replies' } ) ).toBeNull();
		expect( screen.queryByRole( 'button', { name: 'Retry reply' } ) ).toBeNull();
		expect( screen.queryByRole( 'button', { name: 'The report' } ) ).toBeNull();
		expect( screen.getByRole( 'textbox' ).value ).toBe( '' );
		expect( screen.getByRole( 'textbox' ).disabled ).toBe( false );
		expect( document.activeElement ).toBe( screen.getByRole( 'textbox' ) );

	} );

} );
