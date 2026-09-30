import { el } from '../components/dom.js';
import { icon } from '../components/Icon.js';
import { keyCap } from '../components/KeyCap.js';
import layout from './chat-layout.json' with { type: 'json' };

let serial = 0;

/** Optional context for a conversation. Owns its open/read state, never story progress. */
export class ConversationHint {

	constructor( { anchor, onJournal = () => {} } = {} ) {
		this.anchor = anchor;
		this.open = false;
		this.unread = false;
		this.sceneText = '';
		this.signature = '';
		const id = `conversation-hint-${++ serial}`;
		this.trigger = el( 'button', { type: 'button', className: 'chat-hint-trigger' }, icon( 'codex' ), keyCap( layout.hint.key ) );
		this.trigger.setAttribute( 'aria-controls', id );
		this.trigger.setAttribute( 'aria-expanded', 'false' );
		this.trigger.setAttribute( 'aria-keyshortcuts', layout.hint.key );
		this.trigger.addEventListener( 'click', () => this.setOpen( ! this.open ) );
		this.close = el( 'button', { type: 'button', className: 'chat-hint-close', title: layout.hint.close }, icon( 'close' ) );
		this.close.setAttribute( 'aria-label', layout.hint.close );
		this.close.addEventListener( 'click', () => this.setOpen( false ) );
		this.title = el( 'h3', { className: 'chat-quest-title' } );
		this.story = el( 'div', { className: 'chat-story', hidden: true }, this.title );
		this.fields = new Map();
		for ( const { key, label } of layout.hint.sections ) {
			const text = el( 'p', { className: `chat-quest-${key}` } );
			const section = el( 'section', { className: 'chat-hint-section', hidden: true }, el( 'h4', { textContent: label } ), text );
			this.fields.set( key, { section, text } );
			if ( key !== 'scene' ) this.story.append( section );
		}
		this.journal = el( 'button', { type: 'button', className: 'chat-journal', hidden: true }, icon( 'codex' ), layout.story.journal );
		this.journal.addEventListener( 'click', () => { this.setOpen( false, { focus: false } ); onJournal(); } );
		const heading = el( 'span', { id: `${id}-title`, textContent: layout.hint.title } );
		this.body = el( 'div', { className: 'chat-hint-body', tabIndex: 0 }, this.story, this.fields.get( 'scene' ).section );
		this.body.setAttribute( 'role', 'region' );
		this.body.setAttribute( 'aria-label', layout.hint.title );
		this.panel = el( 'section', { className: 'chat-hint-card', id, hidden: true },
			el( 'div', { className: 'chat-hint-head' }, heading, this.close ), this.body, this.journal );
		this.panel.setAttribute( 'role', 'region' );
		this.panel.setAttribute( 'aria-labelledby', heading.id );
		this.element = el( 'div', { className: 'chat-hint', hidden: true }, this.trigger, this.panel );
		this.#label();
	}

	setStory( value ) {
		const story = value ? Object.fromEntries( [ 'title', 'objective', 'stake', 'hint', 'journal' ].map( key => [ key, value[ key ] ] ) ) : null;
		const signature = JSON.stringify( story );
		if ( signature === this.signature ) return;
		this.signature = signature;
		this.title.textContent = story?.title ?? '';
		this.title.hidden = ! this.title.textContent;
		this.story.hidden = ! story;
		for ( const [ key, { section, text } ] of this.fields ) {
			if ( key === 'scene' ) continue;
			text.textContent = story?.[ key ] ?? '';
			section.hidden = ! text.textContent;
		}
		const journalFocused = document.activeElement === this.journal;
		this.journal.hidden = ! story || story.journal === false;
		if ( this.open && journalFocused && this.journal.hidden ) this.close.focus();
		this.#changed();
	}

	setScene( value ) {
		if ( value === this.sceneText ) return;
		this.sceneText = value;
		const { section, text } = this.fields.get( 'scene' );
		text.textContent = value;
		section.hidden = ! value;
		this.#changed();
	}

	setOpen( open, { focus = true, immediate = false } = {} ) {
		open = Boolean( open && ! this.element.hidden );
		clearTimeout( this.exitTimer );
		this.open = open;
		this.trigger.setAttribute( 'aria-expanded', String( open ) );
		this.panel.inert = ! open;
		this.panel.setAttribute( 'aria-hidden', String( ! open ) );
		this.panel.classList.toggle( 'is-closing', ! open );
		this.resize?.disconnect();
		this.listeners?.abort();
		if ( open ) {
			this.unread = false;
			this.#label();
			this.panel.hidden = false;
			this.place();
			this.listeners = new AbortController();
			window.addEventListener( 'resize', () => this.place(), { signal: this.listeners.signal } );
			// The anchor moves when its speaker's subtitle changes or its column resizes.
			if ( typeof ResizeObserver !== 'undefined' ) {
				this.resize ??= new ResizeObserver( () => this.place() );
				this.resize.observe( this.anchor?.parentElement?.parentElement ?? this.element );
				this.resize.observe( this.body );
			}
			if ( focus ) this.close.focus();
		} else {
			if ( focus && ! this.element.hidden && this.panel.contains( document.activeElement ) ) this.trigger.focus();
			if ( immediate || this.panel.hidden || window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches ) this.panel.hidden = true;
			else this.exitTimer = setTimeout( () => { this.panel.hidden = true; }, 160 );
		}
	}

	/** Keep the card above its badge and within the desktop window. Called only while open. */
	place() {
		if ( ! this.open ) return;
		const at = ( this.anchor ?? this.trigger ).getBoundingClientRect();
		this.panel.style.maxHeight = `${Math.max( 100, Math.min( 480, at.top - 28, window.innerHeight - 32 ) )}px`;
		const left = Math.max( 16, Math.min( at.left, window.innerWidth - this.panel.offsetWidth - 16 ) );
		const top = Math.max( 16, at.top - this.panel.offsetHeight - 12 );
		this.panel.style.left = `${left}px`;
		this.panel.style.top = `${top}px`;
	}

	reset() {
		this.setOpen( false, { focus: false, immediate: true } );
		this.setStory( null );
		this.setScene( '' );
		this.unread = false;
		this.#label();
	}

	dispose() {
		this.setOpen( false, { focus: false, immediate: true } );
		this.element.remove();
	}

	#changed() {
		const available = Boolean( this.title.textContent || this.sceneText || [ ...this.fields.values() ].some( field => ! field.section.hidden ) );
		const heldFocus = this.element.contains( document.activeElement );
		this.element.hidden = ! available;
		this.unread = available && ! this.open;
		this.#label();
		if ( ! available ) {
			this.setOpen( false, { focus: false, immediate: true } );
			if ( heldFocus ) this.element.dispatchEvent( new Event( 'hintempty' ) );
		}
		this.place();
	}

	#label() {
		this.trigger.setAttribute( 'aria-label', this.unread ? layout.hint.unread : layout.hint.title );
		this.trigger.title = `${layout.hint.title} (${layout.hint.key})`;
		this.trigger.classList.toggle( 'is-new', this.unread );
	}
}
