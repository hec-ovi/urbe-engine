import { el } from '../components/dom.js';
import { icon } from '../components/Icon.js';
import { PanelHeader } from '../components/PanelHeader.js';

const SPEAKING = new Set( [ 'pending', 'playing', 'idle' ] );

/**
 * Conversation presentation. The caller hands it names, lines, replies and
 * actions as plain values and hears the player's intents through callbacks.
 */
export class ChatPanel {

	constructor( { onSend, onClose, onChoice = () => {}, onTopic = () => {}, onAction = () => {}, onRetry = () => {}, onJournal = () => {} } ) {
		Object.assign( this, { onSend, onChoice, onTopic, onAction } );
		this.header = new PanelHeader( { title: '', onClose } );
		this.header.title.id = 'conversation-name';
		this.role = el( 'div', { className: 'chat-role' } );
		this.story = el( 'div', { className: 'chat-story' } );
		this.topics = group( 'chat-topics', 'Conversation topics' );
		this.transcript = el( 'div', { className: 'chat-transcript' } );
		this.transcript.setAttribute( 'role', 'log' );
		this.transcript.setAttribute( 'aria-label', 'Conversation' );
		this.transcript.setAttribute( 'aria-live', 'polite' );
		/** Lines still growing; the log is busy for assistive technology until each finishes. */
		this.streaming = new Set();
		this.followLatest = true;
		this.transcript.addEventListener( 'scroll', () => {
			const height = this.transcript.clientHeight;
			if ( height === this.transcriptHeight ) this.followLatest = this.transcript.scrollHeight - this.transcript.scrollTop - height < 8;
			this.transcriptHeight = height;
		} );
		if ( typeof ResizeObserver !== 'undefined' ) {
			this.transcriptResize = new ResizeObserver( () => {
				this.#follow();
				this.transcriptHeight = this.transcript.clientHeight;
			} );
			this.transcriptResize.observe( this.transcript );
		}
		this.actions = group( 'chat-actions', 'Suggested actions' );
		this.choices = group( 'chat-choices', 'Your replies' );
		this.status = el( 'div', { className: 'chat-status' } );
		this.status.setAttribute( 'role', 'status' );
		this.retry = el( 'button', { type: 'button', className: 'chat-retry', textContent: 'Retry reply' } );
		this.retry.addEventListener( 'click', onRetry );
		this.feedback = el( 'div', { className: 'chat-feedback' }, this.status, this.retry );
		this.input = el( 'input', { className: 'chat-input', type: 'text', placeholder: 'Ask something else…', maxLength: 2000 } );
		this.input.setAttribute( 'aria-label', 'say something' );
		this.send = el( 'button', { className: 'chat-send', type: 'submit' }, icon( 'send' ) );
		this.send.setAttribute( 'aria-label', 'send' );
		this.compose = el( 'form', { className: 'chat-compose' }, this.input, this.send );
		this.compose.addEventListener( 'submit', event => { event.preventDefault(); this.#send(); } );
		this.composeNote = el( 'div', { className: 'chat-compose-note' } );
		this.journal = el( 'button', { type: 'button', className: 'chat-journal', textContent: 'Open journal' } );
		this.journal.addEventListener( 'click', onJournal );
		this.leave = el( 'button', { type: 'button', className: 'chat-leave', textContent: 'End conversation' } );
		this.leave.addEventListener( 'click', onClose );
		this.card = el( 'div', { className: 'chat' },
			this.header.element, this.role, this.story, this.topics, this.transcript,
			this.actions, this.choices, this.feedback, this.compose, this.composeNote,
			el( 'div', { className: 'chat-footer' }, this.journal, this.leave )
		);
		this.element = el( 'section', { className: 'chat-layer' }, this.card );
		this.element.tabIndex = - 1;
		this.element.addEventListener( 'pointerdown', event => {
			if ( event.target === this.element ) { event.preventDefault(); if ( ! this.element.contains( document.activeElement ) ) this.#focusFallback(); }
		} );
		this.element.setAttribute( 'role', 'dialog' );
		this.element.setAttribute( 'aria-modal', 'true' );
		this.element.setAttribute( 'aria-labelledby', 'conversation-name' );
		this.element.addEventListener( 'keydown', event => {
			if ( event.key === 'Escape' ) { event.preventDefault(); event.stopPropagation(); onClose(); }
			if ( event.key !== 'Tab' ) return;
			const controls = [ ...this.element.querySelectorAll( 'button, input' ) ].filter( node => ! node.disabled && ! node.closest( '[hidden]' ) );
			const first = controls[ 0 ], last = controls.at( -1 );
			if ( document.activeElement === this.element ) { event.preventDefault(); ( event.shiftKey ? last : first )?.focus(); }
			else if ( event.shiftKey && document.activeElement === first ) { event.preventDefault(); last?.focus(); }
			else if ( ! event.shiftKey && document.activeElement === last ) { event.preventDefault(); first?.focus(); }
		} );
		this.setStatus( '' );
		this.setStory( null );
		this.setTopics( [] );
		this.setActions( [] );
		this.setChoices( [] );
		this.setFreeChat( true );
		this.element.hidden = true;
	}

	setNpc( { name, role = '' } ) {
		this.header.setTitle( name );
		this.role.textContent = role;
		this.role.hidden = ! role;
	}

	setStory( story ) {
		this.story.hidden = ! story;
		this.journal.hidden = ! story || story.journal === false;
		this.story.replaceChildren( ...( story ? [
			el( 'div', { className: 'chat-quest-title', textContent: story.title } ),
			...( story.objective ? [ el( 'div', { className: 'chat-quest-objective', textContent: story.objective } ) ] : [] )
		] : [] ) );
		this.#latest();
	}

	setTopics( topics, active = null ) {
		const heldFocus = this.topics.contains( document.activeElement );
		this.topics.hidden = topics.length === 0 || topics.length === 1 && active !== null;
		this.topics.replaceChildren( ...topics.map( topic => {
			const button = el( 'button', { type: 'button', className: 'chat-topic', textContent: topic.title } );
			button.setAttribute( 'aria-pressed', String( topic.key === active ) );
			button.addEventListener( 'click', () => this.onTopic( topic.value ) );
			return button;
		} ) );
		if ( heldFocus ) {
			if ( ! this.topics.hidden ) ( this.topics.querySelector( '[aria-pressed="true"]' ) ?? this.topics.querySelector( 'button' ) )?.focus();
			else this.#focusFallback();
		}
		this.#latest();
	}

	/** One button per `{ id, label }`, carrying its id as `data-action`, reported through `onAction(id)`; an empty list hides the row. */
	setActions( actions ) {
		const heldFocus = this.actions.contains( document.activeElement );
		this.actions.hidden = actions.length === 0;
		this.actions.replaceChildren( ...actions.map( ( { id, label } ) => {
			const button = el( 'button', { type: 'button', className: 'chat-action', textContent: label } );
			button.dataset.action = id;
			button.addEventListener( 'click', () => this.onAction( id ) );
			return button;
		} ) );
		if ( heldFocus ) this.#focusFallback();
		this.#latest();
	}

	setChoices( choices, focus = false ) {
		const heldFocus = this.choices.contains( document.activeElement );
		this.choices.hidden = choices.length === 0;
		this.choices.replaceChildren( ...choices.map( choice => {
			const button = el( 'button', { type: 'button', className: 'chat-choice', disabled: Boolean( choice.disabled ) },
				el( 'span', { textContent: choice.text } ),
				...( choice.hint ? [ el( 'small', { textContent: choice.hint } ) ] : [] )
			);
			button.addEventListener( 'click', () => this.onChoice( choice.value ?? choice.id ) );
			return button;
		} ) );
		if ( focus || heldFocus ) ( this.choices.querySelector( 'button:not(:disabled)' ) ?? this.leave ).focus();
		this.#latest();
	}

	setStatus( text, { error = false, retry = false } = {} ) {
		const retryFocused = document.activeElement === this.retry;
		this.feedback.hidden = ! text;
		this.status.textContent = text;
		this.feedback.classList.toggle( 'is-error', error );
		this.retry.hidden = ! retry;
		if ( retryFocused && this.retry.hidden ) this.#focusFallback();
		this.#latest();
	}

	/** Pending free chat disables the composer; focus it moved away comes back when nothing else took it. */
	setSending( sending ) {
		const composerFocused = this.compose.contains( document.activeElement );
		this.input.disabled = sending;
		this.send.disabled = sending;
		this.compose.setAttribute( 'aria-busy', String( sending ) );
		if ( sending && composerFocused ) {
			this.#focusFallback();
			this.lentFocus = document.activeElement;
		} else if ( ! sending ) {
			if ( this.lentFocus && document.activeElement === this.lentFocus && ! this.compose.hidden ) this.input.focus();
			this.lentFocus = null;
		}
	}

	/** Free chat offered, or withdrawn with a note in its place saying why. */
	setFreeChat( available, note = '' ) {
		const composerFocused = this.compose.contains( document.activeElement );
		this.compose.hidden = ! available;
		this.composeNote.textContent = available ? '' : note;
		this.composeNote.hidden = ! this.composeNote.textContent;
		if ( ! available && composerFocused ) this.#focusFallback();
	}

	/** Appends a whole line and returns its element. */
	addMessage( { from, name, text } ) {
		const line = this.#line( from, name );
		line.lastElementChild.textContent = text;
		return line;
	}

	/**
	 * Opens a line that grows as it arrives: `update(text)` shows the text so
	 * far, `finish()` completes it and `discard()` takes an unfinished line out
	 * of the transcript. Calls after it finished, was discarded or left the
	 * transcript do nothing.
	 */
	beginMessage( { from, name } ) {
		const line = this.#line( from, name );
		const text = line.lastElementChild.appendChild( document.createTextNode( '' ) );
		line.classList.add( 'is-streaming' );
		this.#stream( line, true );
		const open = () => this.streaming.has( line );
		return {
			line,
			update: ( shown ) => {
				if ( ! open() ) return;
				text.data = shown;
				this.#follow();
			},
			finish: () => {
				line.classList.remove( 'is-streaming' );
				this.#stream( line, false );
			},
			discard: () => {
				if ( ! open() ) return;
				this.#stream( line, false );
				line.remove();
			}
		};
	}

	/**
	 * Marks how a shown line is voiced: `pending` while its audio is being
	 * made, `playing` while it is heard and `idle` without either. A line no
	 * longer in the transcript is left alone and false is returned.
	 */
	setSpeaking( line, state ) {
		if ( ! SPEAKING.has( state ) ) throw new TypeError( `unknown speaking state: ${state}` );
		if ( line?.parentNode !== this.transcript ) return false;
		if ( state === 'idle' ) delete line.dataset.speaking;
		else line.dataset.speaking = state;
		return true;
	}

	setTranscript( messages ) {
		this.streaming.clear();
		this.#stream( null, false );
		this.transcript.replaceChildren();
		for ( const message of messages ) this.addMessage( message );
	}

	/** Opens a fresh conversation with `{ name, role? }`, or closes the panel with null. */
	show( npc ) {
		this.element.hidden = ! npc;
		if ( ! npc ) return;
		this.setNpc( npc );
		this.setTranscript( [] );
		this.setStory( null );
		this.setTopics( [] );
		this.setActions( [] );
		this.setChoices( [] );
		this.setStatus( '' );
		this.setSending( false );
		this.setFreeChat( true );
		this.input.value = '';
		this.input.focus();
	}

	setVisible( visible ) { this.element.hidden = ! visible; }

	#line( from, name ) {
		const line = el( 'div', { className: 'chat-line is-' + from },
			el( 'div', { className: 'chat-line-from', textContent: name ?? ( from === 'player' ? 'You' : '' ) } ),
			el( 'div', { className: 'chat-line-text' } )
		);
		this.transcript.append( line );
		this.#latest();
		return line;
	}

	#stream( line, open ) {
		if ( line ) this.streaming[ open ? 'add' : 'delete' ]( line );
		this.transcript.setAttribute( 'aria-busy', String( this.streaming.size > 0 ) );
	}

	/** Shows the newest text unless the player scrolled up to read earlier lines. */
	#follow() {
		if ( this.followLatest ) this.transcript.scrollTop = this.transcript.scrollHeight;
	}

	#latest() {
		this.followLatest = true;
		this.transcript.scrollTop = this.transcript.scrollHeight;
		this.transcriptHeight = this.transcript.clientHeight;
	}

	#focusFallback() {
		const composing = ! this.compose.hidden && ! this.input.disabled;
		( this.choices.querySelector( 'button:not(:disabled)' ) ?? this.actions.querySelector( 'button' ) ?? ( composing ? this.input : this.leave ) ).focus();
	}

	#send() {
		const text = this.input.value.trim();
		if ( ! text || this.input.disabled ) return;
		this.input.value = '';
		this.onSend( text );
	}
}

function group( className, label ) {
	const row = el( 'div', { className } );
	row.setAttribute( 'role', 'group' );
	row.setAttribute( 'aria-label', label );
	return row;
}
