import { el } from '../components/dom.js';
import { icon } from '../components/Icon.js';
import { keyCap } from '../components/KeyCap.js';
import { SubtitleReveal } from './SubtitleReveal.js';
import { ConversationHint } from './ConversationHint.js';
import { ThinkingOrb } from './ThinkingOrb.js';
import layout from './chat-layout.json' with { type: 'json' };

const SPEAKING = new Set( [ 'pending', 'playing', 'idle' ] );
/** Lines the transcript keeps; the oldest leave first. */
const MAX_LINES = 200;
/** Icons for an action's kind, the part of its id before a colon unless it names one. */
const ACTION_ICONS = new Set( [ 'follow', 'lead', 'dismiss' ] );
/** Arrow keys on the talk window's plate, and which way each moves it. */
const NUDGE = { ArrowLeft: [ - 1, 0 ], ArrowRight: [ 1, 0 ], ArrowUp: [ 0, - 1 ], ArrowDown: [ 0, 1 ] };
const SVG = 'http://www.w3.org/2000/svg';

/**
 * Conversation presentation. The caller hands it names, lines, replies and
 * actions as plain values and hears the player's intents through callbacks.
 *
 * Two surfaces over the running world. In the middle of the screen, low, the
 * workflow: the person's name on its badge and an optional context hint,
 * the newest line as a subtitle, then the ways to answer that change the game
 * (numbered story replies, asking the person along, End conversation). In a
 * corner, the talk window, closed until the player opens it: a bowed,
 * draggable frame named after the person with the whole transcript as
 * bubbles, a side tray of the same actions with icons, the thinking orb while
 * a reply is awaited or arrives, and under it a separate bowed composer with
 * the NPC voices toggle. Labels come from [chat-layout.json](chat-layout.json).
 */
export class ChatPanel {

	constructor( { onSend, onClose, onChoice = () => {}, onTopic = () => {}, onAction = () => {}, onRetry = () => {}, onJournal = () => {}, onVoice = () => {} } ) {
		Object.assign( this, { onSend, onChoice, onTopic, onAction, onVoice } );
		/** Text nodes and attributes that name the person, refilled by setNpc. */
		this.named = [];
		/** Lines still growing; the log is busy for assistive technology until each finishes. */
		this.streaming = new Set();
		/** Lines whose voice plays now. */
		this.voiced = new Set();
		this.sending = false;
		this.freeAvailable = true;
		this.talkOpen = false;
		this.trayOpen = false;
		this.followLatest = true;

		// The workflow, centred.
		this.title = el( 'h2', { className: 'chat-name', id: 'conversation-name' } );
		this.role = el( 'div', { className: 'chat-role' } );
		this.badge = el( 'div', { className: 'chat-badge' }, this.title );
		this.hint = new ConversationHint( { anchor: this.badge, onJournal } );
		this.hint.element.addEventListener( 'hintempty', () => this.#focusFallback() );
		this.story = this.hint.story;
		this.journal = this.hint.journal;
		this.sayWho = el( 'span', { className: 'chat-said-who' } );
		this.sayText = document.createTextNode( '' );
		this.sayAccessible = el( 'span', { className: 'chat-sr' } );
		const visible = el( 'span', { className: 'chat-said-visible' }, this.sayText );
		visible.setAttribute( 'aria-hidden', 'true' );
		this.said = el( 'p', { className: 'chat-said' }, this.sayWho, visible, this.sayAccessible );
		this.reveal = new SubtitleReveal( { node: this.sayText, owner: this.said, charactersPerSecond: layout.reveal.charactersPerSecond,
			onState: active => {
				this.said.classList.toggle( 'is-revealing', active );
				if ( active ) { this.said.tabIndex = 0; this.said.setAttribute( 'role', 'button' ); this.said.setAttribute( 'aria-description', layout.reveal.complete ); }
				else {
					const focused = document.activeElement === this.said;
					this.said.removeAttribute( 'tabindex' ); this.said.removeAttribute( 'role' ); this.said.removeAttribute( 'aria-description' );
					if ( focused ) this.element?.focus();
				}
			} } );
		this.said.addEventListener( 'click', () => this.reveal.finish() );
		this.orbSlot = el( 'span', { className: 'chat-orb-slot' } );
		this.subtitle = el( 'div', { className: 'chat-subtitle' }, this.orbSlot, el( 'div', { className: 'chat-said-block' }, this.said ) );
		// While the talk window is closed, the subtitle is where the newest line is heard.
		this.subtitle.setAttribute( 'aria-live', 'polite' );
		this.status = el( 'div', { className: 'chat-status' } );
		this.status.setAttribute( 'role', 'status' );
		this.retry = el( 'button', { type: 'button', className: 'chat-retry', textContent: layout.retry } );
		this.retry.addEventListener( 'click', onRetry );
		this.feedback = el( 'div', { className: 'chat-feedback' }, this.status, this.retry );
		this.topics = this.#group( 'chat-topics', layout.topics );
		this.topicSection = this.#section( layout.topics, this.topics );
		this.choices = this.#group( 'chat-choices', layout.choices );
		this.choiceSection = this.#section( layout.choices, this.choices );
		this.choiceSection.classList.add( 'is-quiet' );
		this.actions = this.#group( 'chat-actions', layout.actions );
		const summary = this.#head( 'summary', layout.actions );
		summary.addEventListener( 'click', () => { this.asksChosen = true; } );
		this.asks = el( 'details', { className: 'chat-section chat-asks' }, summary, this.actions );
		const leaveKey = keyCap( layout.leaveKey );
		leaveKey.setAttribute( 'aria-hidden', 'true' );
		this.leave = el( 'button', { type: 'button', className: 'chat-leave' }, icon( 'leave' ), el( 'span', { textContent: layout.leave } ), leaveKey );
		this.leave.setAttribute( 'aria-label', layout.leave );
		this.leave.addEventListener( 'click', onClose );
		// The person and what they say on the left, the ways to answer on the right.
		this.card = el( 'div', { className: 'chat' },
			el( 'div', { className: 'chat-speaker' },
				el( 'div', { className: 'chat-identity' }, this.badge, this.hint.element, this.role ),
				this.subtitle, this.feedback, this.topicSection ),
			el( 'div', { className: 'chat-options' }, this.choiceSection, this.asks, el( 'div', { className: 'chat-footer' }, this.leave ) )
		);

		// The corner that opens the talk window, or says why there is none.
		const talkKey = keyCap( layout.talk.key );
		talkKey.setAttribute( 'aria-hidden', 'true' );
		this.triggerLabel = el( 'span' );
		this.#name( this.triggerLabel, 'textContent', layout.talk.open );
		this.trigger = el( 'button', { type: 'button', className: 'chat-talk' }, icon( 'talk' ), this.triggerLabel, talkKey );
		this.trigger.addEventListener( 'click', () => this.setTalkOpen( true ) );
		this.composeNote = el( 'div', { className: 'chat-compose-note' } );
		this.free = el( 'div', { className: 'chat-free' }, this.trigger, this.composeNote );

		this.window = this.#window();

		this.element = el( 'section', { className: 'chat-layer' }, this.card, this.free, this.window );
		this.element.tabIndex = - 1;
		this.element.addEventListener( 'pointerdown', event => {
			if ( event.target === this.element ) { event.preventDefault(); if ( ! this.element.contains( document.activeElement ) ) this.#focusFallback(); }
		} );
		this.element.setAttribute( 'role', 'dialog' );
		this.element.setAttribute( 'aria-modal', 'true' );
		this.element.setAttribute( 'aria-labelledby', 'conversation-name' );
		this.element.addEventListener( 'keydown', event => this.#key( event, onClose ) );
		this.element.hidden = true;
		this.setStatus( '' );
		this.setStory( null );
		this.setTopics( [] );
		this.setActions( [] );
		this.setChoices( [] );
		this.setFreeChat( true );
		this.setVoice( null );
		this.#resay();
	}

	setNpc( { name, role = '' } ) {
		this.title.textContent = name;
		this.plateName.textContent = name;
		this.role.textContent = role;
		this.role.hidden = ! role;
		this.badge.title = role;
		this.title.setAttribute( 'aria-description', role );
		this.plateRole.textContent = role;
		for ( const [ set, template ] of this.named ) set( template.replaceAll( '{name}', name ) );
	}

	/**
	 * `{ title, objective?, stake?, journal? }`: the story this conversation is
	 * part of, the player's goal in it and why the talk matters; null hides it.
	 */
	setStory( story ) {
		this.hint.setStory( story );
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
	}

	/**
	 * One button per `{ id, label, icon? }`, carrying its id as `data-action`,
	 * reported through `onAction(id)`; an empty list hides the section. The icon
	 * is `icon`, else the kind before a colon in the id (`follow`, `lead`,
	 * `dismiss`). It stays folded while story replies are offered, unless the
	 * player opened it; the talk window's tray holds the same actions.
	 */
	setActions( actions ) {
		const heldFocus = this.actions.contains( document.activeElement ) || this.trayList.contains( document.activeElement );
		this.asks.hidden = actions.length === 0;
		const button = ( className, { id, label, icon: kind } ) => {
			const shape = kind ?? id.split( ':' )[ 0 ];
			const node = el( 'button', { type: 'button', className }, icon( ACTION_ICONS.has( shape ) ? shape : 'talk' ), label );
			node.dataset.action = id;
			node.addEventListener( 'click', () => this.onAction( id ) );
			return node;
		};
		this.actions.replaceChildren( ...actions.map( ( action ) => button( 'chat-action', action ) ) );
		this.trayList.replaceChildren( ...actions.map( ( action ) => button( 'chat-tray-action', action ) ) );
		this.trayEmpty.hidden = actions.length > 0;
		this.tab.dataset.count = String( actions.length );
		this.#fold();
		if ( heldFocus ) this.#focusFallback();
	}

	/**
	 * Story replies `{ text, value, disabled?, commits? }`, numbered: the number
	 * keys pick them while the text box is not in use. A reply that `commits`
	 * is marked as the one that moves the story on. `focus` puts the first on
	 * focus, unless the player is typing.
	 */
	setChoices( choices, focus = false ) {
		const heldFocus = this.choices.contains( document.activeElement );
		this.choiceSection.hidden = choices.length === 0;
		this.choices.replaceChildren( ...choices.map( ( choice, index ) => {
			const button = el( 'button', { type: 'button', className: 'chat-choice', disabled: Boolean( choice.disabled ) },
				el( 'span', { className: 'chat-choice-text', textContent: choice.text } )
			);
			if ( choice.commits ) {
				// The mark describes the reply; the reply's words alone name it.
				const mark = el( 'small', { className: 'chat-choice-commits chat-sr', id: `chat-commits-${index}`, textContent: layout.choices.commits } );
				mark.setAttribute( 'aria-hidden', 'true' );
				button.setAttribute( 'aria-describedby', mark.id );
				button.append( mark );
				button.title = layout.choices.commits;
			}
			button.append( icon( choice.commits ? 'commit' : 'question' ) );
			button.addEventListener( 'click', () => this.onChoice( choice.value ?? choice.id ) );
			return button;
		} ) );
		this.#fold();
		const typing = this.compose.contains( document.activeElement ) || this.hint.panel.contains( document.activeElement ) && this.hint.open;
		if ( heldFocus || focus && ! typing ) ( this.choices.querySelector( 'button:not(:disabled)' ) ?? this.leave ).focus();
	}

	setStatus( text, { error = false, retry = false } = {} ) {
		const retryFocused = document.activeElement === this.retry;
		this.feedback.hidden = ! text;
		this.status.textContent = text;
		this.feedback.classList.toggle( 'is-error', error );
		this.retry.hidden = ! retry;
		if ( retryFocused && this.retry.hidden ) this.#focusFallback();
	}

	/** Pending free chat disables the composer; focus it moved away comes back when nothing else took it. */
	setSending( sending ) {
		const composerFocused = this.compose.contains( document.activeElement );
		this.sending = sending;
		this.input.disabled = sending;
		this.send.disabled = sending;
		this.compose.setAttribute( 'aria-busy', String( sending ) );
		if ( sending && composerFocused ) {
			this.#focusFallback();
			this.lentFocus = document.activeElement;
		} else if ( ! sending ) {
			if ( this.lentFocus && document.activeElement === this.lentFocus && ! this.compose.hidden && this.talkOpen ) this.input.focus();
			this.lentFocus = null;
		}
		this.#activity();
	}

	/** Free chat offered, or withdrawn with a note in its place saying why; withdrawn, the talk window closes. */
	setFreeChat( available, note = '' ) {
		const composerFocused = this.compose.contains( document.activeElement ) || document.activeElement === this.trigger;
		this.freeAvailable = available;
		this.compose.hidden = ! available;
		this.freeHint.hidden = ! available;
		this.trigger.hidden = ! available || this.talkOpen;
		this.composeNote.textContent = available ? '' : note;
		this.composeNote.hidden = ! this.composeNote.textContent;
		if ( ! available && this.talkOpen ) this.setTalkOpen( false, { focus: false } );
		if ( ! available && composerFocused ) this.#focusFallback();
	}

	/**
	 * The talk window open or closed. Opening puts the text box on focus and
	 * shows the newest lines; closing gives focus back to the button that
	 * opens it. It opens only while free chat is offered.
	 */
	setTalkOpen( open, { focus = true } = {} ) {
		if ( open && ! this.freeAvailable ) return;
		const inside = this.window.contains( document.activeElement );
		if ( open ) this.hint.setOpen( false, { focus: false, immediate: true } );
		this.talkOpen = open;
		this.window.hidden = ! open;
		this.trigger.hidden = ! this.freeAvailable || open;
		this.subtitle.setAttribute( 'aria-live', open ? 'off' : 'polite' );
		if ( ! open ) {
			this.#setTray( false );
			this.#makeRoom( null );
		} else this.#makeRoom( this.#place() );
		this.#activity();
		if ( open ) {
			this.#latest();
			if ( focus ) ( this.input.disabled ? this.plate : this.input ).focus();
		} else if ( focus || inside ) ( this.freeAvailable ? this.trigger : this.leave ).focus();
	}

	/** The NPC voices setting the composer's toggle shows: true or false, or null to leave the toggle out. */
	setVoice( on ) {
		this.voiceOn = on;
		this.voice.hidden = on === null;
		if ( on === null ) return;
		this.voice.setAttribute( 'aria-pressed', String( on ) );
		this.voice.title = on ? layout.voice.on : layout.voice.off;
		this.voice.replaceChildren( icon( on ? 'voice' : 'mute' ) );
	}

	/**
	 * Appends a whole line and returns its element. `from` is `npc`, `player`
	 * or `scene` (the place and moment a story talk opens on, set apart from
	 * speech); `kind` tags a line of the story (`story`) or of free talk (`talk`).
	 */
	addMessage( { from, name, text, kind } ) {
		const line = this.#line( from, name, kind );
		line.lastElementChild.textContent = text;
		if ( kind !== 'talk' ) this.#say( line, { animate: from === 'npc' } );
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
		if ( kind !== 'talk' ) this.#say( line );
		const open = () => this.streaming.has( line );
		return {
			line,
			update: ( shown ) => {
				if ( ! open() ) return;
				text.data = shown;
				if ( this.sayLine === line ) { this.reveal.set( shown ); this.sayAccessible.textContent = shown; }
				if ( from === 'scene' ) this.hint.setScene( shown );
				this.hint.place();
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
				if ( from === 'scene' ) this.hint.setScene( [ ...this.transcript.children ].findLast( each => each.classList.contains( 'is-scene' ) && ! each.classList.contains( 'is-earlier' ) )?.lastElementChild.textContent ?? '' );
				if ( this.sayLine === line ) this.#resay();
			}
		};
	}

	/**
	 * Marks how a shown line is voiced: `pending` while its audio is being
	 * made, `playing` while it is heard and `idle` without either. A line no
	 * longer in the transcript is left alone and false is returned.
	 */
	setSpeaking( line, state, progress ) {
		if ( ! SPEAKING.has( state ) ) throw new TypeError( `unknown speaking state: ${state}` );
		if ( line?.parentNode !== this.transcript ) return false;
		if ( this.sayLine === line ) {
			if ( state === 'playing' ) this.reveal.sync( progress );
			else if ( state === 'idle' && this.reveal.progress ) this.reveal.finish();
		}
		if ( state === 'idle' ) delete line.dataset.speaking;
		else line.dataset.speaking = state;
		this.voiced[ state === 'playing' ? 'add' : 'delete' ]( line );
		this.#activity();
		return true;
	}

	/**
	 * Puts what was said with this person before, `[{ from, name?, text }]`
	 * oldest first, above the conversation's lines, each set apart as earlier.
	 */
	recall( messages ) {
		this.transcript.prepend( ...messages.map( ( { from, name, text } ) => {
			const line = lineOf( from, name, 'earlier' );
			line.classList.add( 'is-earlier' );
			line.lastElementChild.textContent = text;
			return line;
		} ) );
		this.#trim();
		this.#latest();
	}

	setTranscript( messages ) {
		this.streaming.clear();
		this.voiced.clear();
		this.#stream( null, false );
		this.transcript.replaceChildren();
		this.hint.setScene( '' );
		for ( const message of messages ) this.addMessage( message );
		this.#resay();
	}

	/** Opens a fresh conversation with `{ name, role? }`, the talk window closed, or closes the panel with null. */
	show( npc ) {
		this.reveal.cancel();
		this.hint.reset();
		this.element.hidden = ! npc;
		this.setTalkOpen( false, { focus: false } );
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
		this.trigger.focus();
	}

	setVisible( visible ) {
		if ( ! visible ) { this.reveal.finish(); this.hint.setOpen( false, { focus: false, immediate: true } ); }
		this.element.hidden = ! visible;
		this.#activity();
	}

	/** The talk window: its frame, plate, tray tab and tray, transcript, orb and composer. */
	#window() {
		this.plateName = el( 'strong', { className: 'chat-plate-name' } );
		this.plateRole = el( 'span', { className: 'chat-plate-role' } );
		this.plate = el( 'div', { className: 'chat-plate' }, el( 'span', { className: 'chat-plate-kicker', textContent: layout.free.title } ), this.plateName, this.plateRole );
		this.plate.tabIndex = 0;
		this.plate.setAttribute( 'role', 'button' );
		this.plate.setAttribute( 'aria-label', layout.talk.move );
		this.plate.setAttribute( 'aria-keyshortcuts', 'ArrowUp ArrowDown ArrowLeft ArrowRight' );
		this.#drag( this.plate );
		this.closeTalk = el( 'button', { type: 'button', className: 'chat-window-close' }, icon( 'close' ) );
		this.closeTalk.setAttribute( 'aria-label', layout.talk.close );
		this.closeTalk.addEventListener( 'click', () => this.setTalkOpen( false ) );

		this.trayList = el( 'div', { className: 'chat-tray-list' } );
		this.trayList.setAttribute( 'role', 'group' );
		this.trayList.setAttribute( 'aria-label', layout.talk.actions );
		this.trayEmpty = el( 'p', { className: 'chat-tray-empty' } );
		this.#name( this.trayEmpty, 'textContent', layout.talk.empty );
		const back = el( 'button', { type: 'button', className: 'chat-tray-back' }, icon( 'leave' ), layout.talk.back );
		back.addEventListener( 'click', () => { this.#setTray( false ); this.tab.focus(); } );
		this.tray = el( 'section', { className: 'chat-tray', id: 'chat-tray', hidden: true },
			el( 'div', { className: 'chat-tray-head' }, el( 'h3', { textContent: layout.talk.actions } ), back ),
			this.trayList, this.trayEmpty
		);
		this.tab = el( 'button', { type: 'button', className: 'chat-tab' }, icon( 'actions' ), el( 'span', { textContent: layout.talk.actions } ) );
		this.tab.setAttribute( 'aria-expanded', 'false' );
		this.tab.setAttribute( 'aria-controls', this.tray.id );
		this.tab.addEventListener( 'click', () => this.#setTray( ! this.trayOpen ) );

		this.transcript = el( 'div', { className: 'chat-transcript' } );
		this.transcript.setAttribute( 'role', 'log' );
		this.transcript.setAttribute( 'aria-label', layout.log );
		this.transcript.setAttribute( 'aria-live', 'polite' );
		this.transcript.addEventListener( 'scroll', () => {
			const height = this.transcript.clientHeight;
			if ( height === this.transcriptHeight ) this.followLatest = this.transcript.scrollHeight - this.transcript.scrollTop - height < 8;
			this.transcriptHeight = height;
		}, { passive: true } );
		if ( typeof ResizeObserver !== 'undefined' ) {
			this.transcriptResize = new ResizeObserver( () => {
				this.#follow();
				this.transcriptHeight = this.transcript.clientHeight;
			} );
			this.transcriptResize.observe( this.transcript );
		}
		this.orb = new ThinkingOrb( { size: 34 } );
		this.activityLabel = el( 'span', { className: 'chat-activity-label' } );
		this.activityRow = el( 'div', { className: 'chat-activity', hidden: true }, this.activityLabel );

		this.voice = el( 'button', { type: 'button', className: 'chat-voice' } );
		this.voice.setAttribute( 'aria-label', layout.voice.label );
		this.voice.addEventListener( 'click', () => { if ( this.voiceOn !== null ) this.onVoice( ! this.voiceOn ); } );
		this.input = el( 'input', { className: 'chat-input', type: 'text', maxLength: 2000 } );
		this.input.setAttribute( 'aria-label', layout.free.input );
		this.#name( this.input, 'placeholder', layout.free.placeholder );
		this.freeHint = el( 'span', { className: 'chat-sr', id: 'chat-free-hint', textContent: layout.free.hint } );
		this.input.setAttribute( 'aria-describedby', this.freeHint.id );
		this.send = el( 'button', { className: 'chat-send', type: 'submit' }, icon( 'send' ) );
		this.send.setAttribute( 'aria-label', layout.free.send );
		this.compose = el( 'form', { className: 'chat-compose' }, contour( 'compose' ), this.voice, this.input, this.send, this.freeHint );
		this.compose.addEventListener( 'submit', event => { event.preventDefault(); this.#send(); } );

		const frame = el( 'div', { className: 'chat-frame' },
			contour( 'frame' ), el( 'div', { className: 'chat-scan' } ),
			this.plate, this.closeTalk, this.tab,
			el( 'div', { className: 'chat-window-body' }, this.transcript, this.activityRow ),
			this.tray
		);
		const talk = el( 'section', { className: 'chat-window', hidden: true }, frame, this.compose );
		this.#name( talk, 'aria-label', layout.talk.window );
		return talk;
	}

	/** Escape closes (the tray first), Tab stays inside, T opens the talk window and a number key picks that story reply, all while the text box is not in use. */
	#key( event, onClose ) {
		if ( event.key === 'Escape' ) {
			event.preventDefault();
			event.stopPropagation();
			if ( this.hint.open ) this.hint.setOpen( false );
			else if ( this.trayOpen ) { this.#setTray( false ); this.tab.focus(); } else onClose();
			return;
		}
		const typing = event.target.matches?.( 'input, textarea, [contenteditable="true"]' );
		const plain = ! event.ctrlKey && ! event.metaKey && ! event.altKey;
		if ( ! typing && plain && event.key?.toUpperCase() === layout.hint.key && ! this.hint.element.hidden ) {
			event.preventDefault();
			event.stopPropagation();
			if ( ! event.repeat ) this.hint.setOpen( ! this.hint.open );
			return;
		}
		if ( ! typing && plain && event.key?.toUpperCase() === layout.talk.key && this.freeAvailable && ! this.talkOpen ) {
			event.preventDefault();
			this.setTalkOpen( true );
			return;
		}
		if ( ! typing && plain && this.reveal.active && ( event.target === this.said && [ ' ', 'Enter' ].includes( event.key ) || event.target === this.element && event.key === ' ' ) ) {
			event.preventDefault();
			event.stopPropagation();
			this.reveal.finish();
			return;
		}
		const reply = /^[1-9]$/.test( event.key ) && ! typing && plain ? this.choices.children[ Number( event.key ) - 1 ] : null;
		if ( reply ) {
			event.preventDefault();
			if ( ! reply.disabled ) reply.click();
			return;
		}
		if ( event.key !== 'Tab' ) return;
		const controls = [ ...this.element.querySelectorAll( 'button, input, summary, [tabindex="0"]' ) ].filter( node => ! node.disabled && ! node.closest( '[hidden], [inert], [aria-hidden="true"]' ) &&
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

	/** The actions tray beside the talk window, or over its transcript where the screen has no room beside it. */
	#setTray( open ) {
		this.trayOpen = open;
		this.tray.hidden = ! open;
		this.tab.setAttribute( 'aria-expanded', String( open ) );
		if ( ! open ) return;
		// Beside the window only where it covers neither the screen's edge nor the workflow.
		const box = this.window.getBoundingClientRect(), room = this.element.getBoundingClientRect(), card = this.card.getBoundingClientRect();
		const wide = 250, clear = ( from, to ) => to <= card.left || from >= card.right || box.top >= card.bottom || box.bottom <= card.top;
		this.tray.dataset.side = box.right + wide <= room.right && clear( box.right, box.right + wide ) ? 'right'
			: box.left - wide >= room.left && clear( box.left - wide, box.left ) ? 'left' : 'over';
		( this.trayList.querySelector( 'button' ) ?? this.tray.querySelector( '.chat-tray-back' ) ).focus();
	}

	/** Where the talk window stands: kept where the player left it, else in the top left corner, and always inside the screen. */
	#place( x = this.x, y = this.y ) {
		const room = this.element.getBoundingClientRect(), box = this.window.getBoundingClientRect();
		x ??= 24;
		y ??= 24;
		this.x = Math.round( Math.max( 8, Math.min( x, room.width - box.width - 8 ) ) ) || 0;
		this.y = Math.round( Math.max( 8, Math.min( y, room.height - box.height - 8 ) ) ) || 0;
		this.window.style.transform = `translate3d(${this.x}px,${this.y}px,0)`;
		return { room, width: box.width };
	}

	/**
	 * The workflow centres in the screen beside the open talk window, on the
	 * side the window leaves wider when that side keeps 600 px; otherwise, or
	 * with the window closed, in the whole screen.
	 */
	#makeRoom( placed ) {
		let left = '', right = '';
		if ( placed ) {
			const { room, width } = placed, before = this.x - 16, after = room.width - ( this.x + width + 16 );
			if ( after >= before && after >= 600 ) left = `${this.x + width + 16}px`;
			else if ( before >= 600 ) right = `${room.width - before}px`;
		}
		this.card.style.setProperty( '--talk-left', left || '0px' );
		this.card.style.setProperty( '--talk-right', right || '0px' );
		this.hint.place();
	}

	/** The plate moves the window under the pointer, and by the arrow keys. */
	#drag( plate ) {
		let start = null;
		plate.addEventListener( 'pointerdown', ( event ) => {
			if ( event.button !== 0 ) return;
			start = { id: event.pointerId, x: event.clientX - this.x, y: event.clientY - this.y };
			plate.setPointerCapture?.( event.pointerId );
			plate.classList.add( 'is-dragging' );
			event.preventDefault();
		} );
		plate.addEventListener( 'pointermove', ( event ) => {
			if ( start?.id === event.pointerId ) this.#place( event.clientX - start.x, event.clientY - start.y );
		} );
		const end = () => {
			if ( start ) this.#makeRoom( this.#place() );
			start = null;
			plate.classList.remove( 'is-dragging' );
		};
		plate.addEventListener( 'pointerup', end );
		plate.addEventListener( 'pointercancel', end );
		plate.addEventListener( 'keydown', ( event ) => {
			const step = NUDGE[ event.key ];
			if ( ! step ) return;
			event.preventDefault();
			const by = event.shiftKey ? 48 : 16;
			this.#makeRoom( this.#place( this.x + step[ 0 ] * by, this.y + step[ 1 ] * by ) );
		} );
	}

	/** The orb and its words: waiting for a reply, taking one in, or hearing it; in the talk window while it is open, else by the subtitle. */
	#activity() {
		const state = this.element?.hidden !== false ? 'idle'
			: this.streaming.size ? 'streaming' : this.sending ? 'thinking' : this.voiced.size ? 'speaking' : 'idle';
		const home = this.talkOpen ? this.activityRow : this.orbSlot;
		if ( this.orb.element.parentNode !== home ) home.prepend( this.orb.element );
		this.orb.setState( state );
		this.activityRow.hidden = state === 'idle' || ! this.talkOpen;
		this.activityLabel.textContent = state === 'idle' ? '' : layout.activity[ state ];
		this.subtitle.classList.toggle( 'is-waiting', state === 'thinking' );
	}

	/** Scenes belong to the hint; the subtitle carries the latest spoken line. */
	#say( line, { animate = false } = {} ) {
		if ( line?.classList.contains( 'is-scene' ) ) {
			this.hint.setScene( line.lastElementChild.textContent );
			this.#resay();
			return;
		}
		this.sayLine = line;
		const from = line?.className.match( /\bis-(\w+)/ )?.[ 1 ] ?? '';
		this.said.dataset.from = from;
		this.sayWho.textContent = from === 'player' ? layout.from.player : '';
		const text = line?.lastElementChild.textContent ?? '';
		this.sayAccessible.textContent = text;
		this.said.dataset.line = text;
		this.reveal.set( text, { animate } );
		this.subtitle.hidden = ! line;
		this.hint.place();
	}

	#resay() {
		this.#say( [ ...this.transcript.children ].findLast( line => ! line.classList.contains( 'is-earlier' ) && ! line.classList.contains( 'is-scene' ) && line.dataset.kind !== 'talk' ) ?? null );
	}

	#line( from, name, kind ) {
		const line = lineOf( from, name, kind );
		this.transcript.append( line );
		this.#trim();
		this.#latest();
		return line;
	}

	/** The transcript keeps its newest MAX_LINES lines. */
	#trim() {
		while ( this.transcript.children.length > MAX_LINES && ! this.streaming.has( this.transcript.firstElementChild ) ) {
			this.voiced.delete( this.transcript.firstElementChild );
			this.transcript.firstElementChild.remove();
		}
	}

	#stream( line, open ) {
		if ( line ) this.streaming[ open ? 'add' : 'delete' ]( line );
		this.transcript.setAttribute( 'aria-busy', String( this.streaming.size > 0 ) );
		this.#activity();
	}

	/** Shows the newest text unless the player scrolled up to read earlier lines. */
	#follow() {
		if ( this.followLatest && this.talkOpen ) this.transcript.scrollTop = this.#newest();
	}

	#latest() {
		this.followLatest = true;
		if ( ! this.talkOpen ) return;
		this.transcript.scrollTop = this.#newest();
		this.transcriptHeight = this.transcript.clientHeight;
	}

	/** Where the newest text shows: the end of the transcript, as a chat reads. */
	#newest() {
		return Math.max( 0, this.transcript.scrollHeight - this.transcript.clientHeight );
	}

	#focusFallback() {
		const composing = ! this.compose.hidden && ! this.input.disabled;
		if ( this.talkOpen ) return ( composing ? this.input : this.plate ).focus();
		( this.choices.querySelector( 'button:not(:disabled)' ) ?? ( this.asks.open ? this.actions.querySelector( 'button' ) : null ) ??
			( this.freeAvailable ? this.trigger : this.leave ) ).focus();
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

	/** A group of buttons named by its section's title and described by its hint. */
	#group( className, { title, hint } ) {
		const row = el( 'div', { className } );
		row.setAttribute( 'role', 'group' );
		this.#name( row, 'aria-label', title );
		this.#name( row, 'aria-description', hint );
		return row;
	}

	/** A section's heading: its title, and its hint for assistive technology. */
	#head( tag, { title, hint } ) {
		const heading = el( 'span', { className: 'chat-section-title' } );
		const note = el( 'span', { className: 'chat-section-hint chat-sr' } );
		this.#name( heading, 'textContent', title );
		this.#name( note, 'textContent', hint );
		return el( tag, { className: 'chat-section-head' }, heading, note );
	}

	#section( labels, ...content ) {
		return el( 'div', { className: 'chat-section' }, this.#head( 'div', labels ), ...content );
	}
}

/** A transcript line from `from`, named `name` or by who it is from, tagged by `kind`; a person's line carries their initials for its portrait. */
function lineOf( from, name, kind ) {
	const who = name ?? layout.from[ from ] ?? '';
	// The person's name is on the plate and the badge already: their bubbles keep it for assistive technology only.
	const line = el( 'div', { className: 'chat-line is-' + from },
		el( 'div', { className: 'chat-line-from' }, el( 'span', { className: 'chat-line-who', textContent: who } ) ),
		el( 'div', { className: 'chat-line-text' } )
	);
	if ( from === 'npc' ) line.dataset.initials = who.split( /\s+/ ).filter( Boolean ).slice( 0, 2 ).map( ( word ) => word[ 0 ] ).join( '' ).toUpperCase();
	if ( kind ) line.dataset.kind = kind;
	if ( layout.tags[ kind ] ) line.dataset.tag = layout.tags[ kind ];
	return line;
}

/** The window's bowed outline, or the composer's, stretched over its box. */
function contour( kind ) {
	const frame = kind === 'frame';
	const drawing = document.createElementNS( SVG, 'svg' );
	drawing.setAttribute( 'class', `chat-contour chat-contour-${kind}` );
	drawing.setAttribute( 'viewBox', frame ? '0 0 520 380' : '0 0 480 90' );
	drawing.setAttribute( 'preserveAspectRatio', 'none' );
	drawing.setAttribute( 'aria-hidden', 'true' );
	const path = document.createElementNS( SVG, 'path' );
	path.setAttribute( 'd', frame
		? 'M36 26Q260 14 484 26Q497 28 499 42Q507 190 499 338Q497 352 484 354Q260 366 36 354Q23 352 21 338Q13 190 21 42Q23 28 36 26Z'
		: 'M18 10Q240 20 462 10Q474 8 474 20L471 58Q470 66 461 68Q240 78 19 68Q10 66 9 58L6 20Q6 8 18 10Z' );
	path.setAttribute( 'vector-effect', 'non-scaling-stroke' );
	drawing.append( path );
	return drawing;
}
