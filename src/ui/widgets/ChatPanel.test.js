// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import Ajv from 'ajv/dist/2020.js';
import { stubCanvas } from '../test-helpers/canvas.js';
import layout from './chat-layout.json' with { type: 'json' };
import schema from './chat-layout.schema.json' with { type: 'json' };
import { ChatPanel } from './ChatPanel.js';
import { ThinkingOrb } from './ThinkingOrb.js';
import { icon } from '../components/Icon.js';

const ADA = { name: 'Ada Vance', role: 'office worker' };

const STORY = { title: 'The missing report', objective: 'Hear Ada out about the report.', stake: 'Without it the night shift loses its pay.' };
const CHOICES = [
	{ id: 'ask', text: 'Who needs the report?', value: { questId: 'report', stepId: 'meet', choiceId: 'ask' } },
	{ id: 'accept', text: 'I will get the report.', commits: true, value: { questId: 'report', stepId: 'meet', choiceId: 'accept' } }
];

describe( 'ChatPanel', () => {

	let panel, onSend, onClose, onChoice, onTopic, onAction, onRetry, onJournal, onVoice;

	beforeEach( () => {

		stubCanvas();
		onSend = vi.fn();
		onClose = vi.fn();
		onChoice = vi.fn();
		onTopic = vi.fn();
		onAction = vi.fn();
		onRetry = vi.fn();
		onJournal = vi.fn();
		onVoice = vi.fn();
		panel = new ChatPanel( { onSend, onClose, onChoice, onTopic, onAction, onRetry, onJournal, onVoice } );
		document.body.replaceChildren( panel.element );
		panel.show( ADA );

	} );

	afterEach( () => vi.restoreAllMocks() );

	const talk = () => screen.getByRole( 'button', { name: 'Talk with Ada Vance' } );

	it( 'reads its labels from a layout that meets its schema', () => {

		const validate = new Ajv( { allErrors: true, strict: true } ).compile( schema );
		expect( validate( layout ), JSON.stringify( validate.errors ) ).toBe( true );

	} );

	it( 'opens an accessible conversation named as it is told, the role only when given, and the talk window closed', () => {

		expect( screen.getByRole( 'dialog', { name: 'Ada Vance' } ) ).toBeTruthy();
		expect( screen.getByRole( 'heading', { name: 'Ada Vance' } ) ).toBeTruthy();
		expect( panel.role.textContent ).toBe( 'office worker' );
		expect( panel.role.hidden ).toBe( false );
		expect( screen.queryByRole( 'button', { name: 'Open journal' } ) ).toBeNull();
		// Free talk waits behind its button until the player opens it.
		expect( screen.queryByRole( 'textbox' ) ).toBeNull();
		expect( screen.queryByRole( 'log' ) ).toBeNull();
		expect( document.activeElement ).toBe( talk() );
		// No talk is labelled free talk anywhere on the chat.
		expect( screen.queryByText( /free talk/i ) ).toBeNull();
		expect( panel.input.placeholder ).toBe( 'Say anything to Ada Vance' );
		panel.show( { name: 'Someone passing by' } );
		expect( screen.getByRole( 'dialog', { name: 'Someone passing by' } ) ).toBeTruthy();
		expect( panel.role.hidden ).toBe( true );

	} );

	it( 'opens the talk window from its button or T in the top left corner, without a title, and takes it back with its close', async () => {

		const user = userEvent.setup();
		await user.click( talk() );
		const window = screen.getByRole( 'region', { name: 'Conversation with Ada Vance' } );
		expect( window.querySelector( '.chat-plate' ) ).toBeNull();
		expect( window.textContent ).not.toMatch( /free talk/i );
		expect( screen.getByRole( 'log', { name: 'Conversation' } ).getAttribute( 'aria-live' ) ).toBe( 'polite' );
		expect( document.activeElement ).toBe( screen.getByRole( 'textbox', { name: 'say something' } ) );
		expect( screen.queryByRole( 'button', { name: 'Talk with Ada Vance' } ) ).toBeNull();
		await user.click( within( window ).getByRole( 'button', { name: 'Close the talk window' } ) );
		expect( screen.queryByRole( 'region', { name: 'Conversation with Ada Vance' } ) ).toBeNull();
		expect( document.activeElement ).toBe( talk() );
		expect( onClose ).not.toHaveBeenCalled();

		// T opens it again, and is a letter like any other in the text box.
		await user.keyboard( 't' );
		expect( panel.talkOpen ).toBe( true );
		await user.keyboard( 'tea' );
		expect( panel.input.value ).toBe( 'tea' );

		expect( [ panel.x, panel.y ] ).toEqual( [ 8, 8 ] );
		expect( panel.window.style.transform ).toBe( 'translate3d(8px,8px,0)' );

	} );

	it( 'puts messages on their own side and sends trimmed free text once through button or Enter, never blanks', async () => {

		const user = userEvent.setup();
		panel.setTalkOpen( true );
		panel.addMessage( { from: 'npc', name: 'Ada', text: 'Down the steps.' } );
		panel.addMessage( { from: 'player', text: 'Got it.' } );
		const log = within( screen.getByRole( 'log' ) );
		expect( log.getByText( 'Down the steps.' ).closest( '.chat-line' ).classList.contains( 'is-npc' ) ).toBe( true );
		expect( log.getByText( 'Down the steps.' ).closest( '.chat-line' ).dataset.initials ).toBe( 'A' );
		expect( log.getByText( 'Got it.' ).closest( '.chat-line' ).classList.contains( 'is-player' ) ).toBe( true );
		expect( log.getByText( 'You' ) ).toBeTruthy();
		// The scene a story talk opens on reads as the scene, never as a person or a tag.
		const scene = panel.addMessage( { from: 'scene', text: 'The office is dark but for one lamp.' } );
		expect( scene.classList.contains( 'is-scene' ) ).toBe( true );
		expect( scene.firstElementChild.textContent ).toBe( 'Scene' );
		expect( scene.dataset.tag ).toBeUndefined();
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

	it( 'shows the newest line as the subtitle, growing with a streamed one and falling back when it is discarded', () => {

		expect( panel.subtitle.hidden ).toBe( true );
		panel.addMessage( { from: 'npc', name: 'Ada', text: 'Evening.' } );
		expect( panel.sayAccessible.textContent ).toBe( 'Evening.' );
		expect( panel.said.dataset.from ).toBe( 'npc' );
		panel.addMessage( { from: 'player', text: 'Where is the quay?' } );
		expect( panel.sayAccessible.textContent ).toBe( 'Where is the quay?' );
		const reply = panel.beginMessage( { from: 'npc', name: 'Ada' } );
		reply.update( 'Down the' );
		expect( panel.sayAccessible.textContent ).toBe( 'Down the' );
		reply.discard();
		expect( panel.sayAccessible.textContent ).toBe( 'Where is the quay?' );
		// Free talk stays in the talk window while it is open: the subtitle keeps the talk's own lines.
		panel.setTalkOpen( true, { focus: false } );
		panel.addMessage( { from: 'player', text: 'Nice haircut.', kind: 'talk' } );
		const free = panel.beginMessage( { from: 'npc', name: 'Ada', kind: 'talk' } );
		free.update( 'Cut it myself.' );
		expect( panel.sayAccessible.textContent ).toBe( 'Where is the quay?' );
		free.finish();
		// With the talk window closed no reply is out of sight: the person's free talk is said in the subtitle.
		panel.setTalkOpen( false, { focus: false } );
		const unseen = panel.beginMessage( { from: 'npc', name: 'Ada', kind: 'talk' } );
		unseen.update( 'Mind the steps.' );
		expect( panel.sayAccessible.textContent ).toBe( 'Mind the steps.' );
		unseen.discard();
		expect( panel.sayAccessible.textContent ).toBe( 'Where is the quay?' );
		// What was said before stays in the transcript only.
		panel.recall( [ { from: 'npc', name: 'Ada', text: 'Last week.' } ] );
		expect( panel.sayAccessible.textContent ).toBe( 'Where is the quay?' );
		// Scene context is available in the hint, while speech stays under the badge.
		panel.addMessage( { from: 'scene', text: 'The office is dark but for one lamp.' } );
		expect( panel.said.dataset.from ).toBe( 'player' );
		expect( panel.hint.sceneText ).toBe( 'The office is dark but for one lamp.' );
		panel.addMessage( { from: 'npc', name: 'Ada', text: 'The report is gone.', kind: 'story' } );
		expect( panel.sayAccessible.textContent ).toBe( 'The report is gone.' );
		expect( panel.hint.open ).toBe( false );

	} );

	it( 'on a call says the person\'s every line once, in the subtitle, keeps the lines before it in the talk window and ends the call', async () => {

		panel.show( { ...ADA, call: true } );
		panel.setTalkOpen( true );
		const greeting = panel.addMessage( { from: 'npc', name: 'Ada', text: 'Hello?' } );
		expect( panel.sayAccessible.textContent ).toBe( 'Hello?' );
		expect( greeting.classList.contains( 'is-said' ) ).toBe( true );
		expect( panel.element.classList.contains( 'is-call' ) ).toBe( true );

		// The player's typed line stays in the talk window; the person's typed reply is said in the subtitle, the greeting going to history.
		panel.addMessage( { from: 'player', text: 'Where are you?', kind: 'talk' } );
		expect( panel.sayAccessible.textContent ).toBe( 'Hello?' );
		const reply = panel.beginMessage( { from: 'npc', name: 'Ada', kind: 'talk' } );
		reply.update( 'At the quay.' );
		expect( panel.sayAccessible.textContent ).toBe( 'At the quay.' );
		expect( greeting.classList.contains( 'is-said' ) ).toBe( false );
		expect( reply.line.classList.contains( 'is-said' ) ).toBe( true );
		reply.finish();

		const end = screen.getByRole( 'button', { name: 'End call' } );
		await userEvent.setup().click( end );
		expect( onClose ).toHaveBeenCalledOnce();

		// A talk in person ends the conversation again, its typed replies kept to the talk window.
		panel.show( ADA );
		expect( screen.getByRole( 'button', { name: 'End conversation' } ) ).toBeTruthy();
		expect( panel.element.classList.contains( 'is-call' ) ).toBe( false );
		panel.setTalkOpen( true, { focus: false } );
		panel.addMessage( { from: 'npc', name: 'Ada', text: 'Hi.', kind: 'talk' } );
		expect( panel.subtitle.hidden ).toBe( true );

	} );

	it( 'sets a gain apart in the transcript with its kicker, name and picture, never in the subtitle', async () => {

		panel.addMessage( { from: 'npc', name: 'Ada', text: 'Here, take it.' } );
		const line = panel.note( { kind: 'item', title: 'Kessler Block key card', image: Promise.resolve( 'blob:card' ) } );
		expect( line.parentNode ).toBe( panel.transcript );
		expect( line.textContent ).toBe( 'Item acquiredKessler Block key card' );
		await vi.waitFor( () => expect( line.querySelector( 'img' )?.getAttribute( 'src' ) ).toBe( 'blob:card' ) );
		expect( panel.sayAccessible.textContent ).toBe( 'Here, take it.' );
		expect( panel.note( { kind: 'contact', title: 'Ada Vance' } ).textContent ).toBe( 'New contactAda Vance' );
		// Credits and a thing handed over: their kicker, and their kind's icon in the tile.
		for ( const [ kind, kicker ] of [ [ 'paid', 'Paid' ], [ 'received', 'Received' ], [ 'given', 'Handed over' ] ] ) {

			const note = panel.note( { kind, title: 'Ada Vance' } );
			expect( note.textContent ).toBe( `${kicker}Ada Vance` );
			expect( note.classList.contains( `is-${kind}` ) ).toBe( true );
			expect( note.querySelector( '.chat-note-tile svg' ) ).toBeTruthy();

		}
		expect( panel.note( { kind: 'item', title: 'x' } ).querySelector( '.chat-note-tile svg' ) ).toBeNull();

	} );

	it( 'types each complete NPC line, keeps its transcript whole and skips by click or Space without choosing', async () => {
		const user = userEvent.setup();
		const line = panel.addMessage( { from: 'npc', text: 'The report is gone.', kind: 'story' } );
		expect( panel.reveal.active ).toBe( true );
		expect( panel.sayText.data ).toBe( '' );
		expect( line.lastElementChild.textContent ).toBe( 'The report is gone.' );
		expect( panel.sayAccessible.textContent ).toBe( 'The report is gone.' );
		await user.click( panel.said );
		expect( panel.sayText.data ).toBe( 'The report is gone.' );
		expect( panel.reveal.active ).toBe( false );
		panel.addMessage( { from: 'npc', text: 'Find the courier.', kind: 'story' } );
		panel.said.focus(); await user.keyboard( ' ' );
		expect( panel.sayText.data ).toBe( 'Find the courier.' );
		expect( document.activeElement ).toBe( panel.element );
		expect( onChoice ).not.toHaveBeenCalled();
		panel.addMessage( { from: 'npc', text: 'One more thing.' } );
		panel.show( null );
		expect( panel.reveal.active ).toBe( false );
	} );

	it( 'completes from a focused reply, consumes held Space through release, and types the next line again', async () => {
		const user = userEvent.setup();
		panel.addMessage( { from: 'npc', text: 'First, read the report before you decide.', kind: 'story' } );
		panel.setChoices( CHOICES, true );
		const choice = panel.choices.firstElementChild;
		expect( document.activeElement ).toBe( choice );
		await user.keyboard( '[Space>]' );
		expect( panel.sayText.data ).toBe( 'First, read the report before you decide.' );
		expect( document.activeElement ).toBe( choice );
		const repeat = new KeyboardEvent( 'keydown', { key: ' ', repeat: true, bubbles: true, cancelable: true } );
		expect( choice.dispatchEvent( repeat ) ).toBe( false );
		await user.keyboard( '[/Space]' );
		expect( onChoice ).not.toHaveBeenCalled();
		await user.keyboard( ' ' );
		expect( onChoice ).toHaveBeenCalledExactlyOnceWith( CHOICES[ 0 ].value );
		panel.addMessage( { from: 'npc', text: 'The courier can tell you who signed it.', kind: 'story' } );
		expect( panel.reveal.active ).toBe( true );
		expect( panel.sayText.data ).toBe( '' );
		await user.keyboard( ' ' );
		expect( panel.sayText.data ).toBe( 'The courier can tell you who signed it.' );
		expect( onChoice ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'leaves Space to the hint controls and the free-talk composer', async () => {
		const user = userEvent.setup();
		panel.addMessage( { from: 'npc', text: 'The names in the register will tell you why the night crew never came home.', kind: 'story' } );
		panel.setStory( STORY );
		panel.hint.setOpen( true );
		panel.hint.journal.focus();
		await user.keyboard( ' ' );
		expect( onJournal ).toHaveBeenCalledOnce();
		expect( panel.reveal.active ).toBe( true );
		panel.setTalkOpen( true );
		await user.keyboard( 'a b' );
		expect( panel.input.value ).toBe( 'a b' );
		expect( panel.reveal.active ).toBe( true );
		panel.show( null );
	} );

	it( 'paces the visible subtitle with voice progress and finishes when playback ends', () => {
		const frames = new Map(); let id = 0, progress = 0;
		vi.spyOn( globalThis, 'requestAnimationFrame' ).mockImplementation( callback => { frames.set( ++ id, callback ); return id; } );
		vi.spyOn( globalThis, 'cancelAnimationFrame' ).mockImplementation( key => frames.delete( key ) );
		const tick = time => { const pending = [ ...frames.values() ]; frames.clear(); for ( const callback of pending ) callback( time ); };
		const line = panel.addMessage( { from: 'npc', text: 'abcdefghij', kind: 'story' } );
		panel.setSpeaking( line, 'playing', () => progress );
		progress = .4; tick( 1000 ); expect( panel.sayText.data ).toBe( 'abcd' );
		tick( 2000 ); expect( panel.sayText.data ).toBe( 'abcd' );
		progress = .7; tick( 2100 ); expect( panel.sayText.data ).toBe( 'abcdefg' );
		panel.setSpeaking( line, 'idle' );
		expect( panel.sayText.data ).toBe( 'abcdefghij' );
		expect( panel.reveal.active ).toBe( false );
		panel.show( null );
	} );

	it( 'streams a line as it arrives, finishes or discards it, and ignores calls on a line that is done', () => {

		const log = panel.transcript;
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

	it( 'turns the thinking orb while a reply is awaited, arrives or is voiced, in the talk window when it is open, and rests it after', () => {

		const orb = panel.orb.element;
		expect( orb.hidden ).toBe( true );
		panel.setSending( true );
		expect( panel.orb.state ).toBe( 'thinking' );
		expect( orb.hidden ).toBe( false );
		expect( panel.orbSlot.contains( orb ) ).toBe( true );
		expect( ThinkingOrb.turning ).toBe( true );
		panel.setTalkOpen( true );
		expect( panel.activityRow.contains( orb ) ).toBe( true );
		expect( panel.activityRow.hidden ).toBe( false );
		expect( panel.activityRow.textContent ).toBe( 'Thinking' );
		const reply = panel.beginMessage( { from: 'npc', name: 'Ada' } );
		expect( panel.orb.state ).toBe( 'streaming' );
		expect( panel.activityRow.textContent ).toBe( 'Replying' );
		reply.finish();
		panel.setSending( false );
		expect( panel.orb.state ).toBe( 'idle' );
		expect( panel.activityRow.hidden ).toBe( true );
		panel.setSpeaking( reply.line, 'playing' );
		expect( panel.orb.state ).toBe( 'speaking' );
		panel.setSpeaking( reply.line, 'idle' );
		expect( panel.orb.state ).toBe( 'idle' );
		expect( ThinkingOrb.turning ).toBe( false );
		// A closed conversation rests it whatever was pending.
		panel.setSending( true );
		panel.show( null );
		expect( panel.orb.state ).toBe( 'idle' );

	} );

	it( 'gives the composer its focus back after a pending line unless the player moved on', () => {

		panel.setTalkOpen( true );
		const input = screen.getByRole( 'textbox', { name: 'say something' } );
		expect( document.activeElement ).toBe( input );
		panel.setSending( true );
		expect( document.activeElement ).toBe( panel.element );
		panel.setSending( false );
		expect( document.activeElement ).toBe( input );
		panel.setSending( true );
		screen.getByRole( 'button', { name: 'Close the talk window' } ).focus();
		panel.setSending( false );
		expect( document.activeElement ).toBe( screen.getByRole( 'button', { name: 'Close the talk window' } ) );

	} );

	it( 'shows the NPC voices setting on the composer and reports the flip, or leaves the toggle out', async () => {

		panel.setTalkOpen( true );
		expect( screen.queryByRole( 'button', { name: 'NPC voices' } ) ).toBeNull();
		panel.setVoice( true );
		const toggle = screen.getByRole( 'button', { name: 'NPC voices', pressed: true } );
		await userEvent.setup().click( toggle );
		expect( onVoice ).toHaveBeenCalledExactlyOnceWith( false );
		panel.setVoice( false );
		expect( screen.getByRole( 'button', { name: 'NPC voices', pressed: false } ).title ).toBe( layout.voice.off );
		panel.setVoice( null );
		expect( screen.queryByRole( 'button', { name: 'NPC voices' } ) ).toBeNull();

	} );

	it( 'tags lines of the story and of free talk, leaving the text as it is', () => {

		const greeting = panel.addMessage( { from: 'npc', name: 'Ada', text: 'Hello.' } );
		const opening = panel.addMessage( { from: 'npc', name: 'Ada', text: 'The report is gone.', kind: 'story' } );
		const typed = panel.addMessage( { from: 'player', text: 'What report?', kind: 'talk' } );
		const reply = panel.beginMessage( { from: 'npc', name: 'Ada', kind: 'talk' } );
		expect( [ greeting, opening, typed, reply.line ].map( ( line ) => line.dataset.tag ) ).toEqual( [ undefined, 'story', undefined, undefined ] );
		expect( opening.textContent ).toBe( 'AdaThe report is gone.' );

	} );

	it( 'puts what was said before above the conversation, set apart as earlier, and the next conversation starts without it', () => {

		panel.addMessage( { from: 'npc', name: 'Ada', text: 'What can I do for you?' } );
		panel.recall( [ { from: 'player', text: 'Where is the report?' }, { from: 'npc', name: 'Ada', text: 'Gone with the courier.' } ] );
		const lines = [ ...panel.transcript.children ];
		expect( lines.map( ( line ) => line.textContent ) ).toEqual( [ 'YouWhere is the report?', 'AdaGone with the courier.', 'AdaWhat can I do for you?' ] );
		expect( lines.map( ( line ) => [ line.classList.contains( 'is-earlier' ), line.dataset.tag ] ) ).toEqual( [ [ true, 'earlier' ], [ true, 'earlier' ], [ false, undefined ] ] );
		expect( lines[ 0 ].classList.contains( 'is-player' ) ).toBe( true );

		panel.show( ADA );
		expect( panel.transcript.children ).toHaveLength( 0 );

	} );

	it( 'keeps the newest two hundred lines', () => {

		for ( let index = 0; index < 205; index ++ ) panel.addMessage( { from: index % 2 ? 'player' : 'npc', name: 'Ada', text: `line ${index}` } );
		expect( panel.transcript.children ).toHaveLength( 200 );
		expect( panel.transcript.firstElementChild.lastElementChild.textContent ).toBe( 'line 5' );

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

	it( 'offers asking along apart from story replies, folded while replies are offered, with the same actions in the talk window\'s tray, reporting only their ids', async () => {

		const user = userEvent.setup();
		panel.setActions( [ { id: 'follow', label: 'Bring Ada along' }, { id: 'lead:p9', label: 'Go with Ada to the Blue Lantern', icon: 'lead' } ] );
		expect( panel.asks.open ).toBe( true );
		panel.setChoices( CHOICES );
		expect( panel.asks.open ).toBe( false );
		await user.click( screen.getByText( 'Ask Ada Vance along' ) );
		expect( panel.asks.open ).toBe( true );
		panel.setChoices( CHOICES );
		expect( panel.asks.open ).toBe( true );
		const actions = within( screen.getByRole( 'group', { name: 'Ask Ada Vance along' } ) );
		expect( actions.getAllByRole( 'button' ).map( ( button ) => [ button.dataset.action, button.textContent ] ) )
			.toEqual( [ [ 'follow', 'Bring Ada along' ], [ 'lead:p9', 'Go with Ada to the Blue Lantern' ] ] );
		await user.click( actions.getByRole( 'button', { name: 'Go with Ada to the Blue Lantern' } ) );
		expect( onAction ).toHaveBeenCalledExactlyOnceWith( 'lead:p9' );

		// The tray beside the talk window holds the same actions, and Escape folds it before it ends anything.
		panel.setTalkOpen( true );
		const tab = screen.getByRole( 'button', { name: 'Actions', expanded: false } );
		await user.click( tab );
		expect( tab.getAttribute( 'aria-expanded' ) ).toBe( 'true' );
		const tray = within( screen.getByRole( 'group', { name: 'Actions' } ) );
		expect( document.activeElement ).toBe( tray.getByRole( 'button', { name: 'Bring Ada along' } ) );
		await user.click( tray.getByRole( 'button', { name: 'Bring Ada along' } ) );
		expect( onAction.mock.calls.at( - 1 ) ).toEqual( [ 'follow' ] );
		await user.keyboard( '{Escape}' );
		expect( screen.queryByRole( 'group', { name: 'Actions' } ) ).toBeNull();
		expect( document.activeElement ).toBe( tab );
		expect( onClose ).not.toHaveBeenCalled();
		expect( onChoice ).not.toHaveBeenCalled();

		// A card, a hand-over, credits and a purchase each wear their own icon; an unknown kind talks.
		panel.setActions( [
			{ id: 'card:home:p1/floor:1/u1', label: 'Ask for access', icon: 'card' }, { id: 'hand', label: 'Hand over…', icon: 'give' },
			{ id: 'pay:5', label: 'Pay 5 cr', icon: 'credits' }, { id: 'buy:coffee', label: 'Buy cup of coffee · 3 cr', icon: 'buy' }, { id: 'odd', label: 'Odd' }
		] );
		const paths = [ ...document.querySelectorAll( '.chat-action svg path' ) ].map( ( path ) => path.getAttribute( 'd' ) );
		expect( paths ).toHaveLength( 5 );
		expect( new Set( paths ).size ).toBe( 5 );
		expect( paths.every( Boolean ) ).toBe( true );
		expect( paths[ 4 ] ).toBe( icon( 'talk' ).querySelector( 'path' ).getAttribute( 'd' ) );
		panel.setActions( [ { id: 'follow', label: 'Bring Ada along' }, { id: 'lead:p9', label: 'Go with Ada to the Blue Lantern', icon: 'lead' } ] );

		panel.setTalkOpen( false );
		panel.setChoices( [] );
		actions.getByRole( 'button', { name: 'Bring Ada along' } ).focus();
		panel.setActions( [] );
		expect( screen.queryByRole( 'group', { name: 'Ask Ada Vance along' } ) ).toBeNull();
		expect( document.activeElement ).toBe( talk() );

	} );

	it( 'withdraws free chat with a note saying why, and offers it again in the next conversation', () => {

		panel.setFreeChat( false, 'This passer-by has no time to chat.' );
		expect( screen.queryByRole( 'button', { name: /Talk with/ } ) ).toBeNull();
		expect( screen.getByText( 'This passer-by has no time to chat.' ) ).toBeTruthy();
		expect( document.activeElement ).toBe( screen.getByRole( 'button', { name: 'End conversation' } ) );
		panel.setTalkOpen( true );
		expect( panel.talkOpen ).toBe( false );
		panel.show( ADA );
		expect( screen.queryByText( 'This passer-by has no time to chat.' ) ).toBeNull();
		expect( document.activeElement ).toBe( talk() );

	} );

	it( 'follows the end of the transcript as lines arrive, as a chat reads', () => {

		panel.setTalkOpen( true );
		const box = panel.transcript;
		const size = ( scrollHeight ) => Object.defineProperties( box, {
			scrollHeight: { value: scrollHeight, configurable: true }, clientHeight: { value: 100, configurable: true }
		} );
		size( 80 );
		panel.addMessage( { from: 'npc', name: 'Ada', text: 'Evening.' } );
		expect( box.scrollTop ).toBe( 0 );
		size( 400 );
		panel.addMessage( { from: 'scene', text: 'The office is dark but for one lamp.' } );
		panel.addMessage( { from: 'npc', name: 'Ada', text: 'The report is gone.', kind: 'story' } );
		expect( box.scrollTop ).toBe( 300 );
		// A typed line and its reply keep the newest words in view.
		size( 460 );
		panel.addMessage( { from: 'player', text: 'Who took it?', kind: 'talk' } );
		expect( box.scrollTop ).toBe( 360 );
		size( 700 );
		const reply = panel.beginMessage( { from: 'npc', name: 'Ada', kind: 'talk' } );
		expect( box.scrollTop ).toBe( 600 );
		size( 760 );
		reply.update( 'Someone who knew the code.' );
		expect( box.scrollTop ).toBe( 660 );

	} );

	it( 'shows the story and accessible replies, dispatching their exact identities independently of free chat', async () => {

		panel.setStory( STORY );
		panel.setChoices( CHOICES, true );
		expect( screen.getByText( STORY.title ) ).toBeTruthy();
		expect( screen.getByText( STORY.objective ).previousElementSibling.textContent ).toBe( 'Your goal' );
		expect( screen.getByText( STORY.stake ).previousElementSibling.textContent ).toBe( 'Why it matters' );
		panel.setStory( { title: STORY.title, stake: STORY.stake } );
		expect( panel.hint.fields.get( 'objective' ).section.hidden ).toBe( true );
		const replies = within( screen.getByRole( 'group', { name: 'Story replies' } ) );
		const first = replies.getByRole( 'button', { name: 'Who needs the report?' } );
		// Only the reply that commits is marked as moving the story on.
		expect( replies.getByRole( 'button', { name: 'I will get the report.', description: 'Moves the story on' } ) ).toBeTruthy();
		expect( replies.getAllByText( 'Moves the story on' ) ).toHaveLength( 1 );
		expect( first.firstElementChild.textContent ).toBe( 'Who needs the report?' );
		expect( document.activeElement ).toBe( first );
		const user = userEvent.setup();
		await user.keyboard( '{Enter}' );
		expect( onChoice ).toHaveBeenCalledExactlyOnceWith( CHOICES[ 0 ].value );
		await user.click( replies.getByRole( 'button', { name: /I will get the report/ } ) );
		expect( onChoice.mock.calls ).toEqual( [ [ CHOICES[ 0 ].value ], [ CHOICES[ 1 ].value ] ] );
		// A number key picks that reply, except while the text box is in use.
		await user.keyboard( '2' );
		expect( onChoice.mock.calls.at( - 1 ) ).toEqual( [ CHOICES[ 1 ].value ] );
		panel.setTalkOpen( true );
		await user.click( screen.getByRole( 'textbox' ) );
		await user.keyboard( '1' );
		expect( onChoice ).toHaveBeenCalledTimes( 3 );
		expect( screen.getByRole( 'textbox' ).value ).toBe( '1' );
		// A new topic's replies leave the player typing.
		panel.setChoices( CHOICES, true );
		expect( document.activeElement ).toBe( screen.getByRole( 'textbox' ) );
		expect( onSend ).not.toHaveBeenCalled();
		panel.hint.setOpen( true );
		await user.click( screen.getByRole( 'button', { name: 'Open journal' } ) );
		expect( onJournal ).toHaveBeenCalledTimes( 1 );

	} );

	it( 'keeps context folded, handles H and Escape locally, and leaves typed h alone', async () => {
		const user = userEvent.setup();
		panel.setStory( STORY );
		panel.setChoices( CHOICES, true );
		panel.addMessage( { from: 'scene', text: 'One lamp in the office.' } );
		expect( panel.subtitle.hidden ).toBe( true );
		expect( screen.queryByRole( 'button', { name: 'Open journal' } ) ).toBeNull();
		await user.keyboard( 'h' );
		expect( panel.hint.open ).toBe( true );
		expect( document.activeElement ).toBe( panel.hint.close );
		expect( panel.hint.unread ).toBe( false );
		panel.setChoices( CHOICES, true );
		expect( document.activeElement ).toBe( panel.hint.close );
		await user.keyboard( '{Escape}' );
		expect( panel.hint.open ).toBe( false );
		expect( document.activeElement ).toBe( panel.hint.trigger );
		expect( onClose ).not.toHaveBeenCalled();
		await user.keyboard( 'h' );
		await user.keyboard( 'h' );
		expect( panel.hint.open ).toBe( false );
		panel.setTalkOpen( true );
		await user.keyboard( 'hello' );
		expect( panel.input.value ).toBe( 'hello' );
		expect( panel.hint.open ).toBe( false );
		panel.show( { name: 'A passer-by' } );
		expect( panel.hint.element.hidden ).toBe( true );
		expect( panel.hint.sceneText ).toBe( '' );
	} );

	it( 'does not dispatch disabled choices and focuses End conversation when every reply is unavailable', async () => {

		panel.setChoices( CHOICES.map( choice => ( { ...choice, disabled: true } ) ), true );
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

		panel.setTalkOpen( true );
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
		expect( within( screen.getByRole( 'log' ) ).getByText( 'Where did Ada go?' ) ).toBeTruthy();
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
		expect( within( screen.getByRole( 'group', { name: 'Topics' } ) ).getByRole( 'button', { name: first.title } ).getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		await userEvent.setup().click( screen.getByRole( 'button', { name: second.title } ) );
		expect( onTopic ).toHaveBeenCalledExactlyOnceWith( second.value );
		expect( onChoice ).not.toHaveBeenCalled();
		expect( onSend ).not.toHaveBeenCalled();
		panel.setTopics( [ first ], first.key );
		expect( screen.queryByRole( 'button', { name: first.title } ) ).toBeNull();

	} );

	it( 'contains keyboard focus and reports Escape and End conversation once without sending or choosing', async () => {

		panel.setStory( STORY );
		panel.setChoices( CHOICES, true );
		const user = userEvent.setup();
		const hint = screen.getByRole( 'button', { name: /Conversation hint/ } );
		const end = screen.getByRole( 'button', { name: 'End conversation' } );
		talk().focus();
		await user.tab();
		expect( document.activeElement ).toBe( hint );
		await user.tab( { shift: true } );
		expect( document.activeElement ).toBe( talk() );
		panel.setChoices( CHOICES, true );
		const bubbled = vi.fn();
		document.addEventListener( 'keydown', bubbled );
		await user.keyboard( '{Escape}' );
		document.removeEventListener( 'keydown', bubbled );
		expect( bubbled ).not.toHaveBeenCalled();
		expect( onClose ).toHaveBeenCalledTimes( 1 );
		await user.click( end );
		expect( onClose ).toHaveBeenCalledTimes( 2 );
		expect( onChoice ).not.toHaveBeenCalled();
		expect( onSend ).not.toHaveBeenCalled();
		panel.show( null );
		expect( screen.queryByRole( 'dialog' ) ).toBeNull();

	} );

	it( 'keeps static transcript clicks inside the dialog for Escape and keyboard navigation', async () => {

		panel.setTalkOpen( true );
		panel.addMessage( { from: 'npc', text: 'Read this reply before deciding.' } );
		panel.reveal.finish();
		const reply = within( panel.transcript ).getByText( 'Read this reply before deciding.' );
		const user = userEvent.setup();
		await user.click( reply );
		expect( document.activeElement ).toBe( panel.element );
		await user.tab();
		expect( document.activeElement ).toBe( screen.getByRole( 'button', { name: 'End conversation' } ) );
		await user.click( reply );
		await user.tab( { shift: true } );
		expect( document.activeElement ).toBe( screen.getByRole( 'button', { name: 'send' } ) );
		await user.click( reply );
		await user.keyboard( '{Escape}' );
		expect( onClose ).toHaveBeenCalledOnce();

	} );

	it( 'starts the next conversation with fresh content and enabled controls after a pending failed conversation', () => {

		panel.setStory( STORY );
		panel.setChoices( CHOICES );
		panel.setTopics( [ { key: 'report', title: 'The report', value: 'report' } ] );
		panel.setActions( [ { id: 'follow', label: 'Bring Ada along' } ] );
		panel.setTalkOpen( true );
		panel.addMessage( { from: 'npc', text: 'The old conversation.' } );
		panel.setStatus( 'Old failure', { error: true, retry: true } );
		panel.setSending( true );
		panel.input.value = 'old draft';
		panel.show( { name: 'Kip Thorn', role: 'vendor' } );
		expect( screen.getByRole( 'dialog', { name: 'Kip Thorn' } ) ).toBeTruthy();
		expect( panel.role.textContent ).toBe( 'vendor' );
		expect( panel.talkOpen ).toBe( false );
		expect( screen.queryByText( 'The old conversation.' ) ).toBeNull();
		expect( screen.queryByRole( 'group', { name: 'Story replies' } ) ).toBeNull();
		expect( screen.queryByRole( 'group', { name: 'Ask Kip Thorn along' } ) ).toBeNull();
		expect( screen.queryByRole( 'button', { name: 'Retry reply' } ) ).toBeNull();
		expect( screen.queryByRole( 'button', { name: 'The report' } ) ).toBeNull();
		expect( panel.input.value ).toBe( '' );
		expect( panel.input.disabled ).toBe( false );
		expect( document.activeElement ).toBe( screen.getByRole( 'button', { name: 'Talk with Kip Thorn' } ) );

	} );

} );
