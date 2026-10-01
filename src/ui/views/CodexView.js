import { el } from '../components/dom.js';
import { PanelHeader } from '../components/PanelHeader.js';
import { ItemPreview } from '../components/ItemPreview.js';
import { questMark } from '../components/QuestMark.js';
import { seedOf } from '../components/itemModels.js';
import layout from './codex-layout.json' with { type: 'json' };
import shapes from './item-shapes.json' with { type: 'json' };

/** Records drawn in one category's list; a category holds at most this many cards. */
const MAX_CARDS = 240;

/**
 * What the player has come across, one category at a time (Items, People,
 * Places, then any other category an entry names): the category's cards,
 * each a 3D thumbnail over its title, a line and two facts, a search within
 * it, and the picked record read on the right with its model turning in its
 * figure. There is no view of everything together. Labels and categories come
 * from [codex-layout.json](codex-layout.json) ([schema](codex-layout.schema.json)).
 * props: { onClose, onQuest( questId )?, preview? } where preview is the
 * ItemPreview it shares with the inventory.
 */
export class CodexView {

	constructor( { onClose, onQuest = () => {}, preview = new ItemPreview( { fallback: layout.preview } ) } ) {

		this.entries = [];
		this.selected = null;
		this.category = layout.categories[ 0 ].id;
		this.picked = new Map();
		this.query = '';
		this.onQuest = onQuest;
		this.preview = preview;
		this.onScreen = false;
		this.cards = new Map();
		this.observer = null;
		/** Each record's own picture, asked for once: entry id -> promise of its URL or null. */
		this.pictures = new Map();

		this.tabs = el( 'nav', { className: 'screen-tabs codex-tabs' } );
		this.tabs.setAttribute( 'aria-label', layout.tabs );
		this.categoryTitle = el( 'h3', { className: 'codex-category-title' } );
		this.resultCount = el( 'output', { className: 'codex-result-count' } );
		this.categoryText = el( 'p', { className: 'codex-category-text' } );
		this.searchLabel = el( 'span' );
		this.search = el( 'input', { className: 'codex-search', type: 'search', autocomplete: 'off' } );
		this.search.addEventListener( 'input', () => {

			this.query = this.search.value;
			this.#filter();

		} );
		this.list = el( 'div', { className: 'codex-list' } );
		this.cardsBox = el( 'div', { className: 'codex-cards' } );
		this.source = el( 'p', { className: 'codex-note' } );
		this.list.append( this.cardsBox, this.source );
		this.detail = el( 'article', { className: 'codex-detail', tabIndex: - 1 } );
		this.figure = el( 'figure', { className: 'codex-figure' } );

		this.header = new PanelHeader( { title: layout.title, subtitle: layout.subtitle, onClose } );
		this.element = el( 'div', { className: 'view view-codex' },
			this.header.element,
			this.tabs,
			el( 'div', { className: 'codex-body' },
				el( 'aside', { className: 'codex-index' },
					el( 'div', { className: 'codex-index-heading' }, this.categoryTitle, this.resultCount, this.categoryText ),
					el( 'label', { className: 'codex-search-label' }, this.searchLabel, this.search ),
					this.list
				),
				this.detail
			)
		);

		this.setEntries( [] );

	}

	/**
	 * @param entries [{ id, title, category, kind?, text, summary?, subtitle?, tags?: [string],
	 *   facts?: [{ label, value }], location?, quote?, source?, model?, image?,
	 *   related?: [{ label, title, entry?: id, quest?: questId, kind?: 'main' | 'side' }] }]
	 * A blank line in `text` starts a paragraph; `image` is the record's own
	 * picture, a URL or a loader resolving with one (or null), asked for once as
	 * its card comes into view while the screen is shown, and shown on the card
	 * and in the figure; else `model` is its own preview model, else an item
	 * `kind`'s shape as the inventory draws it, else its category's shape.
	 */
	setEntries( entries = [] ) {

		this.entries = entries;
		this.categories = [ ...layout.categories ];
		for ( const entry of entries ) {

			const id = entry.category ?? 'notes';
			if ( ! this.categories.some( ( category ) => category.id === id ) ) this.categories.push( { id, label: id, text: '', shape: 'parcel', source: '' } );

		}
		if ( ! this.categories.some( ( category ) => category.id === this.category ) ) this.category = this.categories[ 0 ].id;
		this.#renderTabs();
		this.#renderCards();
		this.#filter();

	}

	/** Opens one record in its own category; null clears the pick. */
	select( id ) {

		const entry = this.entries.find( ( candidate ) => candidate.id === id );
		if ( entry && categoryOf( entry ) !== this.category ) {

			this.category = categoryOf( entry );
			this.query = '';
			this.search.value = '';
			this.#renderTabs();
			this.#renderCards();

		}
		this.selected = entry?.id ?? null;
		if ( entry ) this.picked.set( this.category, entry.id );
		this.#filter();

	}

	/** Shows one category: its cards, its last pick. */
	setCategory( id ) {

		if ( ! this.categories.some( ( category ) => category.id === id ) || id === this.category ) return;
		this.category = id;
		this.query = '';
		this.search.value = '';
		this.selected = this.picked.get( id ) ?? null;
		this.#renderTabs();
		this.#renderCards();
		this.#filter();
		this.list.scrollTop = 0;

	}

	shown() {

		this.onScreen = true;
		this.preview.setVisible( true );
		this.#observe();
		this.#article( true );

	}

	hidden() {

		this.onScreen = false;
		this.observer?.disconnect();
		this.preview.setVisible( false );

	}

	#renderTabs() {

		const counts = new Map();
		for ( const entry of this.entries ) counts.set( categoryOf( entry ), ( counts.get( categoryOf( entry ) ) ?? 0 ) + 1 );
		this.tabs.replaceChildren( ...this.categories.map( ( category ) => {

			const tab = el( 'button', { className: 'screen-tab codex-tab', type: 'button' },
				el( 'span', { textContent: category.label } ),
				el( 'span', { className: 'screen-count', textContent: String( counts.get( category.id ) ?? 0 ) } )
			);
			tab.dataset.category = category.id;
			tab.setAttribute( 'aria-pressed', String( category.id === this.category ) );
			tab.addEventListener( 'click', () => this.setCategory( category.id ) );
			return tab;

		} ) );

	}

	#renderCards() {

		this.observer?.disconnect();
		this.cards.clear();
		const category = this.categories.find( ( candidate ) => candidate.id === this.category );
		const entries = this.entries.filter( ( entry ) => categoryOf( entry ) === this.category ).slice( 0, MAX_CARDS );
		this.cardsBox.replaceChildren( ...entries.map( ( entry ) => {

			const card = this.#card( entry, category );
			this.cards.set( entry.id, card );
			return card.button;

		} ) );
		this.source.textContent = category.source;
		this.source.hidden = ! category.source;
		this.#observe();

	}

	#card( entry, category ) {

		const image = el( 'img', { className: 'codex-record-image', alt: '', draggable: false } );
		image.hidden = true;
		const facts = ( entry.facts ?? [] ).slice( 0, 2 );
		const button = el( 'button', { className: 'codex-record', type: 'button' },
			el( 'span', { className: 'codex-record-art', ariaHidden: 'true' }, image ),
			el( 'span', { className: 'codex-record-copy' },
				el( 'strong', { className: 'codex-record-title', textContent: entry.title } ),
				...( entry.summary ?? firstParagraph( entry.text ) ? [ el( 'span', { className: 'codex-record-summary', textContent: entry.summary ?? firstParagraph( entry.text ) } ) ] : [] )
			),
			...( facts.length ? [ el( 'span', { className: 'codex-record-facts' }, ...facts.map( ( fact ) => el( 'span', {},
				el( 'span', { className: 'codex-fact-label', textContent: fact.label } ),
				el( 'span', { className: 'codex-fact-value', textContent: fact.value } )
			) ) ) ] : [] )
		);
		button.dataset.id = entry.id;
		button.setAttribute( 'aria-label', entry.title );
		button.addEventListener( 'click', () => this.select( entry.id ) );
		return { button, image, entry, model: modelOf( entry, category ), requested: false };

	}

	/** Thumbnails for the cards in view, and only while the screen is. */
	#observe() {

		if ( ! this.onScreen ) return;
		if ( typeof IntersectionObserver !== 'function' ) {

			for ( const card of this.cards.values() ) this.#thumbnail( card );
			return;

		}
		this.observer ??= new IntersectionObserver( ( records ) => {

			for ( const record of records ) {

				if ( ! record.isIntersecting ) continue;
				const card = this.cards.get( record.target.dataset.id );
				if ( card ) this.#thumbnail( card );

			}

		}, { root: this.list, rootMargin: '160px' } );
		for ( const card of this.cards.values() ) if ( ! card.requested && ! card.button.hidden ) this.observer.observe( card.button );

	}

	#thumbnail( card ) {

		if ( card.requested ) return;
		card.requested = true;
		this.observer?.unobserve( card.button );
		// The record's own picture when it has one, else its model's thumbnail.
		this.#picture( card.entry ).then( ( picture ) => picture ?? this.preview.thumbnail( card.model ) ).then( ( url ) => {

			if ( ! url || ! card.button.isConnected ) return;
			card.image.classList.toggle( 'is-picture', url === this.pictures.get( card.entry.id )?.url );
			card.image.src = url;
			card.image.hidden = false;

		} );

	}

	#filter() {

		const category = this.categories.find( ( candidate ) => candidate.id === this.category );
		const all = this.entries.filter( ( entry ) => categoryOf( entry ) === this.category );
		const terms = this.query.toLowerCase().split( /\s+/ ).filter( Boolean );
		const matches = all.filter( ( entry ) => terms.every( ( term ) => searchText( entry ).includes( term ) ) );
		if ( ! matches.some( ( entry ) => entry.id === this.selected ) ) this.selected = this.picked.get( this.category ) && matches.some( ( entry ) => entry.id === this.picked.get( this.category ) ) ? this.picked.get( this.category ) : matches[ 0 ]?.id ?? null;
		if ( this.selected ) this.picked.set( this.category, this.selected );
		const shown = new Set( matches.map( ( entry ) => entry.id ) );
		for ( const [ id, card ] of this.cards ) {

			card.button.hidden = ! shown.has( id );
			card.button.setAttribute( 'aria-pressed', String( id === this.selected ) );

		}
		this.categoryTitle.textContent = category.label;
		this.categoryText.textContent = category.text;
		this.categoryText.hidden = ! category.text;
		this.resultCount.textContent = terms.length
			? fill( layout.results, { count: matches.length, total: all.length } )
			: all.length === 1 ? layout.entriesOne : fill( layout.entries, { count: all.length } );
		this.searchLabel.textContent = fill( layout.search, { category: category.label } );
		this.search.placeholder = fill( layout.placeholder, { category: category.label } );
		for ( const tab of this.tabs.children ) tab.setAttribute( 'aria-pressed', String( tab.dataset.category === this.category ) );
		this.#observe();
		this.#article();

	}

	#article( force = false ) {

		const entry = this.entries.find( ( candidate ) => candidate.id === this.selected ) ?? null;
		const key = entry ? entry : this.category + this.query;
		if ( ! force && key === this.shownArticle ) return;
		this.shownArticle = key;
		this.detail.scrollTop = 0;
		if ( ! entry ) {

			const category = this.categories.find( ( candidate ) => candidate.id === this.category );
			const searching = Boolean( this.query.trim() ) && this.entries.some( ( candidate ) => categoryOf( candidate ) === this.category );
			const message = searching ? layout.noMatch : layout.empty;
			const clear = el( 'button', { className: 'screen-button', type: 'button', textContent: layout.clear } );
			clear.addEventListener( 'click', () => {

				this.query = '';
				this.search.value = '';
				this.#filter();
				this.search.focus();

			} );
			this.detail.replaceChildren( el( 'div', { className: 'codex-empty' },
				el( 'h3', { className: 'codex-empty-title', textContent: fill( message.title, { category: category.label } ) } ),
				el( 'p', { className: 'codex-empty-text', textContent: message.text } ),
				...( searching ? [ clear ] : [] )
			) );
			if ( this.onScreen ) this.preview.setModel( null );
			return;

		}

		const category = this.categories.find( ( candidate ) => candidate.id === categoryOf( entry ) );
		const facts = entry.facts ?? [];
		this.figure.replaceChildren();
		this.detail.replaceChildren( el( 'div', { className: 'codex-article is-arriving' },
			el( 'span', { className: 'codex-article-category', textContent: category.label } ),
			el( 'div', { className: 'codex-feature' },
				el( 'div', {},
					el( 'h3', { className: 'codex-article-title', textContent: entry.title } ),
					...( entry.subtitle ? [ el( 'p', { className: 'codex-article-subtitle', textContent: entry.subtitle } ) ] : [] ),
					...( entry.tags?.length ? [ el( 'div', { className: 'codex-tags' }, ...entry.tags.map( ( tag ) => el( 'span', { className: 'codex-tag', textContent: tag } ) ) ) ] : [] )
				),
				this.figure
			),
			...( entry.location ? [ el( 'span', { className: 'codex-location', textContent: entry.location } ) ] : [] ),
			...( facts.length ? [ el( 'dl', { className: 'codex-detail-facts' }, ...facts.map( ( fact ) => el( 'div', {},
				el( 'dt', { className: 'codex-fact-label', textContent: fact.label } ),
				el( 'dd', { className: 'codex-fact-value', textContent: fact.value } )
			) ) ) ] : [] ),
			el( 'div', { className: 'codex-prose' }, ...paragraphs( entry.text ).map( ( text ) => el( 'p', { textContent: text } ) ) ),
			...( entry.quote ? [ el( 'blockquote', { className: 'codex-quote', textContent: entry.quote } ) ] : [] ),
			...( entry.source ? [ el( 'p', { className: 'codex-source' },
				el( 'span', { className: 'codex-source-label', textContent: layout.source } ),
				el( 'span', { className: 'codex-source-text', textContent: entry.source } )
			) ] : [] ),
			...( entry.related?.length ? [ el( 'div', { className: 'codex-related' }, ...entry.related.map( ( link ) => this.#link( link ) ) ) ] : [] )
		) );
		if ( this.onScreen ) this.#figure( entry, category );

	}

	/** The record's own picture in the figure, else its model turning there. */
	#figure( entry, category ) {

		const showModel = () => {

			this.preview.attach( this.figure );
			this.preview.setModel( modelOf( entry, category ), entry.title );

		};
		if ( ! entry.image ) return showModel();
		const picture = el( 'img', { className: 'codex-picture', alt: entry.title, draggable: false } );
		picture.hidden = true;
		this.figure.replaceChildren( picture );
		this.preview.setModel( null );
		this.#picture( entry ).then( ( url ) => {

			if ( this.selected !== entry.id || ! picture.isConnected ) return;
			if ( ! url ) return showModel();
			picture.src = url;
			picture.hidden = false;

		} );

	}

	/** Asks once for a record's own picture (`image`: a URL, or a loader resolving with one or null). */
	#picture( entry ) {

		if ( ! entry.image ) return Promise.resolve( null );
		let asked = this.pictures.get( entry.id );
		if ( ! asked ) {

			const load = typeof entry.image === 'function' ? entry.image : () => entry.image;
			asked = { url: null, promise: Promise.resolve().then( load ).then( ( url ) => {

				asked.url = typeof url === 'string' ? url : null;
				if ( ! asked.url ) this.pictures.delete( entry.id );
				return asked.url;

			}, () => {

				this.pictures.delete( entry.id );
				return null;

			} ) };
			this.pictures.set( entry.id, asked );

		}
		return asked.promise;

	}

	#link( link ) {

		const kind = link.kind === 'main' ? 'main' : link.kind === 'side' ? 'side' : null;
		const button = el( 'button', { className: 'codex-related-link', type: 'button' },
			...( kind ? [ questMark( kind ) ] : [] ),
			el( 'span', { className: 'codex-related-copy' },
				el( 'span', { className: 'codex-related-label', textContent: link.label ?? ( kind ? layout.questKinds[ kind ] : layout.related ) } ),
				el( 'span', { className: 'codex-related-title', textContent: link.title } )
			),
			el( 'span', { className: 'codex-related-arrow', textContent: '→', ariaHidden: 'true' } )
		);
		button.addEventListener( 'click', () => {

			if ( link.quest ) this.onQuest( link.quest );
			else if ( link.entry ) {

				this.select( link.entry );
				this.detail.focus( { preventScroll: true } );

			}

		} );
		return button;

	}

}

function categoryOf( entry ) {

	return entry.category ?? 'notes';

}

/** The record's own model, else its item kind's shape as the inventory draws it, else its category's. */
function modelOf( entry, category ) {

	return entry.model ?? ( shapes[ entry.kind ] ? { shape: shapes[ entry.kind ] } : { shape: category?.shape ?? 'parcel', seed: seedOf( entry.id ) } );

}

function paragraphs( text = '' ) {

	return String( text ).split( /\n\s*\n/ ).map( ( part ) => part.trim() ).filter( Boolean );

}

function firstParagraph( text ) {

	return paragraphs( text )[ 0 ] ?? '';

}

function searchText( entry ) {

	return [ entry.title, entry.summary, entry.subtitle, entry.text, entry.location, ...( entry.tags ?? [] ), ...( entry.facts ?? [] ).map( ( fact ) => fact.value ) ]
		.filter( Boolean ).join( ' ' ).toLowerCase();

}

function fill( template, values ) {

	return template.replace( /\{(\w+)\}/g, ( match, name ) => String( values[ name ] ?? match ) );

}
