import { el } from '../components/dom.js';
import { icon } from '../components/Icon.js';
import { PanelHeader } from '../components/PanelHeader.js';
import layout from './chat-layout.json' with { type: 'json' };

const SPEAKING = new Set( [ 'pending', 'playing', 'idle' ] );

/**
 * Conversation presentation. The caller hands it names, lines, replies and
 * actions as plain values and hears the player's intents through callbacks.
 * Under the transcript each way to answer has its own labelled section:
 * story replies, asking the person along, and free talk. Labels come from
 * [chat-layout.json](chat-layout.json).
 */
export class ChatPanel {

	constructor( { onSend, onClose, onChoice = () => {}, onTopic = () => {}, onAction = () => {}, onRetry = () => {}, onJournal = () => {} } ) {
		Object.assign( this, { onSend, onChoice, onTopic, onAction } );
		/** Text nodes and attributes that name the person, refilled by setNpc. */
		this.named = [];
		this.header = new PanelHeader( { title: '', onClose } );
		this.header.title.id = 'conversation-name';
		this.role = el( 'div', { className: 'chat-role' } );
		this.journal = el( 'button', { type: 'button', className: 'chat-journal', textContent: layout.story.journal } );
		this.journal.addEventListener( 'click', onJournal );
		this.story = el( 'div', { className: 'chat-story' } );
		this.topics = this.#group( 'chat-topics', layout.topics.title );
		this.topicSection = this.#section( layout.topics, this.topics );
		this.transcript = el( 'div', { className: 'chat-transcript' } );
		this.transcript.setAttribute( 'role', 'log' );
		this.transcript.setAttribute( 'aria-label', layout.log );
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
		this.choices = this.#group( 'chat-choices', layout.choices.title );
		this.choiceSection = this.#section( layout.choices, this.choices );
		this.actions = this.#group( 'chat-actions', layout.actions.title );
		const summary = this.#head( 'summary', layout.actions );
		summary.addEventListener( 'click', () => { this.asksChosen = true; } );
		this.asks = el( 'details', { className: 'chat-section chat-asks' }, summary, this.actions );
		this.status = el( 'div', { className: 'chat-status' } );
		this.status.setAttribute( 'role', 'status' );
		this.retry = el( 'button', { type: 'button', className: 'chat-retry', textContent: layout.retry } );
		this.retry.addEventListener( 'click', onRetry );
		this.feedback = el( 'div', { className: 'chat-feedback' }, this.status, this.retry );
		this.input = el( 'input', { className: 'chat-input', type: 'text', maxLength: 2000 } );
		this.input.setAttribute( 'aria-label', layout.free.input );
		this.#name( this.input, 'placeholder', layout.free.placeholder );
		this.send = el( 'button', { className: 'chat-send', type: 'submit' }, icon( 'send' ) );
		this.send.setAttribute( 'aria-label', layout.free.send );
		this.compose = el( 'form', { className: 'chat-compose' }, this.input, this.send );
		this.compose.addEventListener( 'submit', event => { event.preventDefault(); this.#send(); } );
		this.composeNote = el( 'div', { className: 'chat-compose-note' } );
		this.freeSection = this.#section( layout.free, this.compose, this.composeNote );
		this.freeHint = this.freeSection.querySelector( '.chat-section-hint' );
		this.leave = el( 'button', { type: 'button', className: 'chat-leave', textContent: layout.leave } );
		this.leave.addEventListener( 'click', onClose );
		this.card = el( 'div', { className: 'chat' },
			this.header.element, this.role, this.story, this.topicSection, this.transcript,
			this.feedback, this.choiceSection, this.asks, this.freeSection,
			el( 'div', { className: 'chat-footer' }, this.leave )
		);
		this.element = el( 'section', { className: 'chat-layer' }, this.card );
		this.element.tabIndex = - 1;
		this.element.addEventListener( 'pointerdown', event => {
			if ( event.target === this.element ) { event.preventDefault(); if ( ! this.element.contains( document.activeElement ) ) this.#focusFallback(); }
		} );
		this.element.setAttribute( 'role', 'dialog' );
		this.element.setAttribute( 'aria-modal', 'true' );
		this.element.setAttribute( 'aria-labelledby', 'conversation-name' );
		this.element.addEventListener( 'keydown', event => this.#key( event, onClose ) );
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
		for ( const [ set, template ] of this.named ) set( template.replaceAll( '{name}', name ) );
	}

	/** `{ title, objective?, journal? }`: the story this conversation is part of and the player's goal in it; null hides it. */
	setStory( story ) {
		this.story.hidden = ! story;
		this.journal.hidden = ! story || story.journal === false;
		this.story.replaceChildren( ...( story ? [
			el( 'div', { className: 'chat-quest-kicker', textContent: layout.story.kicker } ),
			el( 'div', { className: 'chat-quest-title', textContent: story.title } ),
			...( story.objective ? [ el( 'div', { className: 'chat-quest-goal' },
				el( 'span', { className: 'chat-quest-label', textContent: layout.story.goal } ),
				el( 'span', { className: 'chat-quest-objective', textContent: story.objective } )
			) ] : [] ),
			this.journal
		] : [] ) );
		this.#latest();
	}

	setTopics( topics, active = null ) {
		const heldFocus = this.topics.contains( document.activeElement );
		this.topicSection.hidden = topics.length === 0 || topics.length === 1 && active !== null;
		this.topics.replaceChildren( ...topics.map( topic => {
			const button = el( 'button', { type: 'button', className: 'chat-topic', textContent: topic.title } );
			button.setAttribute( 'aria-pressed', String( topic.key === active ) );
			button.addEventListener( 'click', () => this.onTopic( topic.value ) );
			return button;
		} ) );
		if ( heldFocus ) {
			if ( ! this.topicSection.hidden ) ( this.topics.querySelector( '[aria-pressed="true"]' ) ?? this.topics.querySelector( 'button' ) )?.focus();
			else this.#focusFallback();
		}
		this.#latest();
	}

	/**
	 * One button per `{ id, label }`, carrying its id as `data-action`, reported
	 * through `onAction(id)`; an empty list hides the section. It stays folded
	 * while story replies are offered, unless the player opened it.
	 */
	setActions( actions ) {
		const heldFocus = this.actions.contains( document.activeElement );
		this.asks.hidden = actions.length === 0;
		this.actions.replaceChildren( ...actions.map( ( { id, label } ) => {
			const button = el( 'button', { type: 'button', className: 'chat-action', textContent: label } );
			button.dataset.action = id;
			button.addEventListener( 'click', () => this.onAction( id ) );
			return button;
		} ) );
		this.#fold();
		if ( heldFocus ) this.#focusFallback();
		this.#latest();
	}

	/** Story replies, numbered: the number keys pick them while the text box is not in use. */
	setChoices( choices, focus = false ) {
		const heldFocus = this.choices.contains( document.activeElement );
		this.choiceSection.hidden = choices.length === 0;
		this.choices.replaceChildren( ...choices.map( choice => {
			const button = el( 'button', { type: 'button', className: 'chat-choice', disabled: Boolean( choice.disabled ) },
				el( 'span', { textContent: choice.text } ),
				...( choice.hint ? [ el( 'small', { textContent: choice.hint } ) ] : [] )
			);
			button.addEventListener( 'click', () => this.onChoice( choice.value ?? choice.id ) );
			return button;
		} ) );
		this.#fold();
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
		this.freeHint.hidden = ! available;
		this.composeNote.textContent = available ? '' : note;
		this.composeNote.hidden = ! this.composeNote.textContent;
		if ( ! available && composerFocused ) this.#focusFallback();
	}

	/** Appends a whole line and returns its element; `kind` tags a line of the story (`story`) or of free talk (`talk`). */
	addMessage( { from, name, text, kind } ) {
		const line = this.#line( from, name, kind );
		line.lastElementChild.textContent = text;
		return line;
	}

	/**
	 * Opens a line that grows as it arrives: `update(text)` shows the text so
	 * far, `finish()` completes it and `discard()` takes an unfinished line out
	 * of the transcript. Calls after it finished, was discarded or left the
	 * transcript do nothing.
	 */
	beginMessage( { from, name, kind } ) {
		const line = this.#line( from, name, kind );
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
		this.asksChosen = false;
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

	/** Escape closes, Tab stays inside, and a number key picks that story reply while the text box is not in use. */
	#key( event, onClose ) {
		if ( event.key === 'Escape' ) { event.preventDefault(); event.stopPropagation(); onClose(); return; }
		const reply = /^[1-9]$/.test( event.key ) && event.target !== this.input && ! event.ctrlKey && ! event.metaKey && ! event.altKey
			? this.choices.children[ Number( event.key ) - 1 ] : null;
		if ( reply ) {
			event.preventDefault();
			if ( ! reply.disabled ) reply.click();
			return;
		}
		if ( event.key !== 'Tab' ) return;
		const controls = [ ...this.element.querySelectorAll( 'button, input, summary' ) ].filter( node => ! node.disabled && ! node.closest( '[hidden]' ) &&
			( node.tagName === 'SUMMARY' || ! node.closest( 'details:not([open])' ) ) );
		const first = controls[ 0 ], last = controls.at( -1 );
		if ( document.activeElement === this.element ) { event.preventDefault(); ( event.shiftKey ? last : first )?.focus(); }
		else if ( event.shiftKey && document.activeElement === first ) { event.preventDefault(); last?.focus(); }
		else if ( ! event.shiftKey && document.activeElement === last ) { event.preventDefault(); first?.focus(); }
	}

	/** Asking along is folded away while story replies are offered, unless the player opened or closed it. */
	#fold() {
		if ( ! this.asksChosen ) this.asks.open = this.choiceSection.hidden;
	}

	#line( from, name, kind ) {
		const line = el( 'div', { className: 'chat-line is-' + from },
			el( 'div', { className: 'chat-line-from', textContent: name ?? ( from === 'player' ? layout.you : '' ) } ),
			el( 'div', { className: 'chat-line-text' } )
		);
		if ( layout.tags[ kind ] ) line.dataset.tag = layout.tags[ kind ];
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
		( this.choices.querySelector( 'button:not(:disabled)' ) ?? ( this.asks.open ? this.actions.querySelector( 'button' ) : null ) ??
			( composing ? this.input : this.leave ) ).focus();
	}

	#send() {
		const text = this.input.value.trim();
		if ( ! text || this.input.disabled ) return;
		this.input.value = '';
		this.onSend( text );
	}

	/** Sets `node[key]`, or its `aria-` attribute, from `template` with the person's name, at each setNpc. */
	#name( node, key, template ) {
		const set = key.startsWith( 'aria-' ) ? ( value ) => node.setAttribute( key, value ) : ( value ) => { node[ key ] = value; };
		this.named.push( [ set, template ] );
		set( template.replaceAll( '{name}', '' ).trim() );
	}

	/** A group of buttons named by its section's title. */
	#group( className, title ) {
		const row = el( 'div', { className } );
		row.setAttribute( 'role', 'group' );
		this.#name( row, 'aria-label', title );
		return row;
	}

	/** A section's heading: its title and a one-line hint. */
	#head( tag, { title, hint } ) {
		const heading = el( 'span', { className: 'chat-section-title' } );
		const note = el( 'span', { className: 'chat-section-hint' } );
		this.#name( heading, 'textContent', title );
		this.#name( note, 'textContent', hint );
		return el( tag, { className: 'chat-section-head' }, heading, note );
	}

	#section( labels, ...content ) {
		return el( 'div', { className: 'chat-section' }, this.#head( 'div', labels ), ...content );
	}
}
