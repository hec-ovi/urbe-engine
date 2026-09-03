// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { ChatPanel } from './ChatPanel.js';

const CONVERSATION = {
	instance: {
		npcId: 'n1',
		name: { given: 'Ada', family: 'Vance' },
		type: 'office_worker',
		home: { parcelId: 'p12', unit: 3 },
		job: { parcelId: 'p40', role: 'clerk', shift: { startMin: 540, endMin: 1020, kind: 'day' } },
		routine: [ { days: [ 0, 1, 2, 3, 4 ], startMin: 540, endMin: 1020, activity: 'working', place: { kind: 'parcel', id: 'p40' } } ]
	},
	behavior: { activity: 'working', mode: 'indoors', place: { kind: 'parcel', id: 'p40' }, interrupted: true }
};

/** Name and Esc up top, messages in the middle, what you type goes out. */
describe( 'ChatPanel', () => {

	let panel, onSend, onClose;

	beforeEach( () => {

		onSend = vi.fn();
		onClose = vi.fn();
		panel = new ChatPanel( { onSend, onClose } );
		document.body.replaceChildren( panel.element );
		panel.setVisible( true );

	} );

	it( 'setNpc names who you are talking to', () => {

		panel.setNpc( { name: 'Ada Vance', role: 'clerk' } );
		expect( screen.getByRole( 'heading', { name: 'Ada Vance · clerk' } ) ).toBeTruthy();

	} );

	it( 'the Esc button and Escape in the input both close', async () => {

		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: 'close' } ) );
		await user.type( screen.getByRole( 'textbox' ), '{Escape}' );

		expect( onClose ).toHaveBeenCalledTimes( 2 );

	} );

	it( 'send and Enter deliver the trimmed text and clear the line; blank sends nothing', async () => {

		const user = userEvent.setup();
		const input = screen.getByRole( 'textbox', { name: 'say something' } );

		await user.type( input, '  where is the quay?  ' );
		await user.click( screen.getByRole( 'button', { name: 'send' } ) );
		await user.type( input, 'thanks{Enter}' );
		await user.click( screen.getByRole( 'button', { name: 'send' } ) );

		expect( onSend.mock.calls ).toEqual( [ [ 'where is the quay?' ], [ 'thanks' ] ] );
		expect( input.value ).toBe( '' );

	} );

	it( 'messages land in the transcript on their side', () => {

		panel.addMessage( { from: 'npc', name: 'Ada', text: 'Down the steps.' } );
		panel.addMessage( { from: 'player', text: 'Got it.' } );

		expect( screen.getByText( 'Down the steps.' ).closest( '.chat-line' ).classList.contains( 'is-npc' ) ).toBe( true );
		expect( screen.getByText( 'Got it.' ).closest( '.chat-line' ).classList.contains( 'is-player' ) ).toBe( true );
		expect( screen.getByText( 'you' ) ).toBeTruthy();

		panel.setTranscript( [] );
		expect( panel.transcript.children ).toHaveLength( 0 );

	} );

	it( 'show opens on a simulation conversation with the profile, and closes on null', () => {

		panel.show( CONVERSATION );

		expect( panel.element.hidden ).toBe( false );
		expect( screen.getByRole( 'heading', { name: 'Ada Vance · office worker' } ) ).toBeTruthy();
		expect( screen.getByText( 'p40' ) ).toBeTruthy();
		expect( screen.getByText( /working · indoors · parcel p40 +\(paused for you\)/ ) ).toBeTruthy();
		expect( screen.getByText( 'MonTueWedThuFri 09:00-17:00 working @ parcel p40' ) ).toBeTruthy();

		panel.show( { instance: null } );
		expect( screen.getByRole( 'heading', { name: 'Someone passing by' } ) ).toBeTruthy();

		panel.show( null );
		expect( panel.element.hidden ).toBe( true );

	} );

} );
