import { el } from '../components/dom.js';
import { PanelHeader } from '../components/PanelHeader.js';
import { icon } from '../components/Icon.js';
import '../components/contacts.css';
import layout from './contacts-layout.json' with { type: 'json' };

/**
 * The people the player can call, as the codex lays out its records: a card
 * per contact with their own portrait, name, role and whether they would pick
 * up now, a search, and the picked contact read on the right with the last
 * thing they said and the button that calls them. Labels come from
 * [contacts-layout.json](contacts-layout.json) ([schema](contacts-layout.schema.json)).
 * props: { onClose, onCall( id ) }
 */
export class ContactsView {

	constructor( { onClose, onCall = () => {} } ) {

		this.onCall = onCall;
		this.contacts = [];
		this.selected = null;
		this.query = '';
		this.onScreen = false;
		this.cards = new Map();
		this.observer = null;
		/** Each contact's portrait, asked for once: id -> promise of its URL or null. */
		this.pictures = new Map();

		this.count = el( 'output', { className: 'codex-result-count' } );
		this.search = el( 'input', { className: 'codex-search', type: 'search', autocomplete: 'off', placeholder: layout.placeholder } );
		this.search.addEventListener( 'input', () => {

			this.query = this.search.value;
			this.#filter();

		} );
		this.cardsBox = el( 'div', { className: 'codex-cards' } );
		this.list = el( 'div', { className: 'codex-list' }, this.cardsBox, el( 'p', { className: 'codex-note', textContent: layout.source } ) );
		this.detail = el( 'article', { className: 'codex-detail contacts-detail', tabIndex: - 1 } );

		this.header = new PanelHeader( { title: layout.title, subtitle: layout.subtitle, onClose } );
		this.element = el( 'div', { className: 'view view-codex view-contacts' },
			this.header.element,
			el( 'div', { className: 'codex-body' },
				el( 'aside', { className: 'codex-index' },
					el( 'div', { className: 'codex-index-heading' },
						el( 'h3', { className: 'codex-category-title', textContent: layout.heading } ),
						this.count,
						el( 'p', { className: 'codex-category-text', textContent: layout.text } )
					),
					el( 'label', { className: 'codex-search-label' }, el( 'span', { textContent: layout.search } ), this.search ),
					this.list
				),
				this.detail
			)
		);
		this.setContacts( [] );

	}

	/**
	 * @param contacts [{ id, name, role?, status: 'online' | 'busy' | 'offline', activity?, added?, met?, line?, lastTalk?, image? }]
	 *   in the order they were added: `status` says whether they would pick up now and `activity` what their day has them doing (the simulation's word),
	 *   `line` is the last thing they said and `lastTalk` when; `image` is their portrait, a URL or a loader resolving
	 *   with one or null, asked for once as the card comes into view while the screen is shown.
	 */
	setContacts( contacts = [] ) {

		this.contacts = contacts;
		const ids = new Set( contacts.map( ( contact ) => contact.id ) );
		for ( const id of this.pictures.keys() ) if ( ! ids.has( id ) ) this.pictures.delete( id );
		this.observer?.disconnect();
		this.cards.clear();
		this.cardsBox.replaceChildren( ...contacts.map( ( contact ) => {

			const card = this.#card( contact );
			this.cards.set( contact.id, card );
			return card.button;

		} ) );
		this.#filter( true );

	}

	/** Picks one contact; null clears the pick. */
	select( id ) {

		this.selected = this.contacts.some( ( contact ) => contact.id === id ) ? id : null;
		this.#filter( true );

	}

	shown() {

		this.onScreen = true;
		this.#observe();
		this.#article( true );

	}

	hidden() {

		this.onScreen = false;
		this.observer?.disconnect();

	}

	#card( contact ) {

		const image = el( 'img', { className: 'codex-record-image is-picture', alt: '', draggable: false } );
		image.hidden = true;
		const call = el( 'button', { className: 'contacts-call-quick', type: 'button', title: fill( layout.call, contact ) }, icon( 'phone' ) );
		call.setAttribute( 'aria-label', fill( layout.call, contact ) );
		call.addEventListener( 'click', ( event ) => {

			event.stopPropagation();
			this.onCall( contact.id );

		} );
		const button = el( 'button', { className: 'codex-record contacts-record', type: 'button' },
			el( 'span', { className: 'codex-record-art', ariaHidden: 'true' }, image ),
			el( 'span', { className: 'codex-record-copy' },
				el( 'strong', { className: 'codex-record-title', textContent: contact.name } ),
				el( 'span', { className: 'codex-record-summary', textContent: contact.role ?? '' } )
			),
			el( 'span', { className: 'codex-record-facts' },
				el( 'span', {},
					el( 'span', { className: 'codex-fact-label', textContent: layout.facts.now } ),
					el( 'span', { className: 'codex-fact-value contacts-presence', textContent: layout.activities[ contact.activity ] ?? presence( contact ) } )
				)
			)
		);
		button.dataset.id = contact.id;
		button.dataset.presence = contact.status ?? 'offline';
		button.setAttribute( 'aria-label', contact.name );
		button.addEventListener( 'click', () => this.select( contact.id ) );
		const holder = el( 'div', { className: 'contacts-card' }, button, call );
		holder.dataset.id = contact.id;
		return { button: holder, record: button, image, contact, requested: false };

	}

	/** Portraits for the cards in view, and only while the screen is. */
	#observe() {

		if ( ! this.onScreen ) return;
		if ( typeof IntersectionObserver !== 'function' ) {

			for ( const card of this.cards.values() ) this.#thumbnail( card );
			return;

		}
		this.observer ??= new IntersectionObserver( ( records ) => {

			for ( const record of records ) {

				const card = record.isIntersecting ? this.cards.get( record.target.dataset.id ) : null;
				if ( card ) this.#thumbnail( card );

			}

		}, { root: this.list, rootMargin: '160px' } );
		for ( const card of this.cards.values() ) if ( ! card.requested && ! card.button.hidden ) this.observer.observe( card.button );

	}

	#thumbnail( card ) {

		if ( card.requested ) return;
		card.requested = true;
		this.observer?.unobserve( card.button );
		this.#picture( card.contact ).then( ( url ) => {

			if ( ! url || ! card.button.isConnected ) return;
			card.image.src = url;
			card.image.hidden = false;

		} );

	}

	#filter( force = false ) {

		const terms = this.query.toLowerCase().split( /\s+/ ).filter( Boolean );
		const matches = this.contacts.filter( ( contact ) => terms.every( ( term ) => `${contact.name} ${contact.role ?? ''}`.toLowerCase().includes( term ) ) );
		if ( ! matches.some( ( contact ) => contact.id === this.selected ) ) this.selected = matches[ 0 ]?.id ?? null;
		const shown = new Set( matches.map( ( contact ) => contact.id ) );
		for ( const [ id, card ] of this.cards ) {

			card.button.hidden = ! shown.has( id );
			card.record.setAttribute( 'aria-pressed', String( id === this.selected ) );

		}
		const total = this.contacts.length;
		this.count.textContent = terms.length
			? fill( layout.results, { count: matches.length, total } )
			: total === 1 ? layout.entriesOne : fill( layout.entries, { count: total } );
		this.#observe();
		this.#article( force );

	}

	#article( force = false ) {

		const contact = this.contacts.find( ( candidate ) => candidate.id === this.selected ) ?? null;
		const key = contact ?? this.query;
		if ( ! force && key === this.shownArticle ) return;
		this.shownArticle = key;
		if ( ! contact ) {

			const searching = Boolean( this.query.trim() ) && this.contacts.length > 0;
			const message = searching ? layout.noMatch : layout.empty;
			const clear = el( 'button', { className: 'screen-button', type: 'button', textContent: layout.clear } );
			clear.addEventListener( 'click', () => {

				this.query = '';
				this.search.value = '';
				this.#filter();
				this.search.focus();

			} );
			this.detail.replaceChildren( el( 'div', { className: 'codex-empty' },
				el( 'h3', { className: 'codex-empty-title', textContent: message.title } ),
				el( 'p', { className: 'codex-empty-text', textContent: message.text } ),
				...( searching ? [ clear ] : [] )
			) );
			return;

		}

		const figure = el( 'figure', { className: 'codex-figure contacts-figure' } );
		const call = el( 'button', { className: 'screen-button is-primary contacts-call', type: 'button' }, icon( 'phone' ), el( 'span', { textContent: fill( layout.call, contact ) } ) );
		call.dataset.presence = contact.status ?? 'offline';
		call.addEventListener( 'click', () => this.onCall( contact.id ) );
		const facts = [
			[ layout.facts.role, contact.role ],
			[ layout.facts.now, layout.activities[ contact.activity ] ?? presence( contact ) ],
			[ layout.facts.met, contact.met ],
			[ layout.facts.added, contact.added ]
		].filter( ( [ , value ] ) => value );
		this.detail.replaceChildren( el( 'div', { className: 'codex-article is-arriving' },
			el( 'span', { className: 'codex-article-category', textContent: layout.category } ),
			el( 'div', { className: 'codex-feature' },
				el( 'div', {},
					el( 'h3', { className: 'codex-article-title', textContent: contact.name } ),
					...( contact.role ? [ el( 'p', { className: 'codex-article-subtitle', textContent: contact.role } ) ] : [] ),
					el( 'div', { className: 'codex-tags' }, el( 'span', { className: 'codex-tag contacts-presence-tag', textContent: presence( contact ) } ) ),
					call
				),
				figure
			),
			el( 'dl', { className: 'codex-detail-facts' }, ...facts.map( ( [ label, value ] ) => el( 'div', {},
				el( 'dt', { className: 'codex-fact-label', textContent: label } ),
				el( 'dd', { className: 'codex-fact-value', textContent: value } )
			) ) ),
			...( contact.line ? [
				el( 'blockquote', { className: 'codex-quote', textContent: contact.line } ),
				el( 'p', { className: 'codex-source' },
					el( 'span', { className: 'codex-source-label', textContent: layout.lastTalk } ),
					...( contact.lastTalk ? [ el( 'span', { className: 'codex-source-text', textContent: contact.lastTalk } ) ] : [] )
				)
			] : [] )
		) );
		this.detail.querySelector( '.codex-tag' ).dataset.presence = contact.status ?? 'offline';
		if ( ! this.onScreen ) return;
		const picture = el( 'img', { className: 'codex-picture', alt: contact.name, draggable: false } );
		picture.hidden = true;
		figure.replaceChildren( picture );
		this.#picture( contact ).then( ( url ) => {

			if ( ! url || this.selected !== contact.id || ! picture.isConnected ) return;
			picture.src = url;
			picture.hidden = false;

		} );

	}

	/** Asks once for a contact's portrait (`image`: a URL, or a loader resolving with one or null). */
	#picture( contact ) {

		if ( ! contact.image ) return Promise.resolve( null );
		let asked = this.pictures.get( contact.id );
		if ( ! asked ) {

			const load = typeof contact.image === 'function' ? contact.image : () => contact.image;
			asked = Promise.resolve().then( load ).then( ( url ) => typeof url === 'string' ? url : null, () => null ).then( ( url ) => {

				if ( ! url ) this.pictures.delete( contact.id );
				return url;

			} );
			this.pictures.set( contact.id, asked );

		}
		return asked;

	}

}

function presence( contact ) {

	return layout.presence[ contact.status ] ?? layout.presence.offline;

}

function fill( template, values ) {

	return template.replace( /\{(\w+)\}/g, ( field, name ) => String( values[ name ] ?? field ) );

}
