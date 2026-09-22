import { el } from '../components/dom.js';
import { icon } from '../components/Icon.js';
import { PanelHeader } from '../components/PanelHeader.js';

/** Conversation presentation. Simulation schedules belong in diagnostics. */
export class ChatPanel {
	constructor( { onSend, onClose, onChoice = () => {}, onTopic = () => {}, onRetry = () => {}, onJournal = () => {} } ) {
		Object.assign( this, { onSend, onChoice, onTopic } );
		this.header = new PanelHeader( { title: '', onClose } );
		this.header.title.id = 'conversation-name';
		this.role = el( 'div', { className: 'chat-role' } );
		this.story = el( 'div', { className: 'chat-story' } );
		this.topics = el( 'div', { className: 'chat-topics' } );
		this.topics.setAttribute( 'aria-label', 'Conversation topics' );
		this.transcript = el( 'div', { className: 'chat-transcript' } );
		this.transcript.setAttribute( 'role', 'log' );
		this.transcript.setAttribute( 'aria-label', 'Conversation' );
		this.transcript.setAttribute( 'aria-live', 'polite' );
		this.followLatest = true;
		this.transcript.addEventListener( 'scroll', () => {
			const height = this.transcript.clientHeight;
			if ( height === this.transcriptHeight ) this.followLatest = this.transcript.scrollHeight - this.transcript.scrollTop - height < 8;
			this.transcriptHeight = height;
		} );
		if ( typeof ResizeObserver !== 'undefined' ) {
			this.transcriptResize = new ResizeObserver( () => {
				if ( this.followLatest ) this.transcript.scrollTop = this.transcript.scrollHeight;
				this.transcriptHeight = this.transcript.clientHeight;
			} );
			this.transcriptResize.observe( this.transcript );
		}
		this.choices = el( 'div', { className: 'chat-choices' } );
		this.choices.setAttribute( 'role', 'group' );
		this.choices.setAttribute( 'aria-label', 'Your replies' );
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
		this.journal = el( 'button', { type: 'button', className: 'chat-journal', textContent: 'Open journal' } );
		this.journal.addEventListener( 'click', onJournal );
		this.leave = el( 'button', { type: 'button', className: 'chat-leave', textContent: 'End conversation' } );
		this.leave.addEventListener( 'click', onClose );
		this.card = el( 'div', { className: 'chat' },
			this.header.element, this.role, this.story, this.topics, this.transcript,
			this.choices, this.feedback, this.compose,
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
		this.setChoices( [] );
		this.element.hidden = true;
	}

	setNpc( { name, role = '' } ) {
		this.header.setTitle( name );
		this.role.textContent = role.replace( /^quest[ _]/i, '' ).replace( /_/g, ' ' );
		this.role.hidden = ! this.role.textContent;
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

	setSending( sending ) {
		const composerFocused = document.activeElement === this.input || document.activeElement === this.send;
		this.input.disabled = sending;
		this.send.disabled = sending;
		this.compose.setAttribute( 'aria-busy', String( sending ) );
		if ( sending && composerFocused ) this.#focusFallback();
	}

	addMessage( { from, name, text } ) {
		this.transcript.append( el( 'div', { className: 'chat-line is-' + from },
			el( 'div', { className: 'chat-line-from', textContent: name ?? ( from === 'player' ? 'You' : '' ) } ),
			el( 'div', { textContent: text } )
		) );
		this.transcript.scrollTop = this.transcript.scrollHeight;
	}

	setTranscript( messages ) { this.transcript.replaceChildren(); for ( const message of messages ) this.addMessage( message ); }

	show( conversation ) {
		this.element.hidden = ! conversation;
		if ( ! conversation ) return;
		const person = conversation.instance;
		this.setNpc( { name: person ? person.name.given + ' ' + person.name.family : 'Someone passing by', role: person?.type ?? '' } );
		this.setTranscript( [] );
		this.setStory( null );
		this.setTopics( [] );
		this.setChoices( [] );
		this.setStatus( '' );
		this.setSending( false );
		this.input.value = '';
		this.input.focus();
	}

	setVisible( visible ) { this.element.hidden = ! visible; }

	#latest() {
		this.followLatest = true;
		this.transcript.scrollTop = this.transcript.scrollHeight;
		this.transcriptHeight = this.transcript.clientHeight;
	}

	#focusFallback() {
		( this.choices.querySelector( 'button:not(:disabled)' ) ?? ( this.input.disabled ? this.leave : this.input ) ).focus();
	}

	#send() {
		const text = this.input.value.trim();
		if ( ! text || this.input.disabled ) return;
		this.input.value = '';
		this.onSend( text );
	}
}
