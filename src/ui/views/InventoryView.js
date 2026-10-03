import { el } from '../components/dom.js';
import { PanelHeader } from '../components/PanelHeader.js';
import { ItemPreview } from '../components/ItemPreview.js';
import { questMark } from '../components/QuestMark.js';
import layout from './inventory-layout.json' with { type: 'json' };
import shapes from './item-shapes.json' with { type: 'json' };

const PAGE = layout.columns * layout.rows;

/**
 * What the player carries: a square grid of named cards a page at a time,
 * each card a 3D thumbnail over the item's name on its own strip, and the
 * picked item's detail beside it with its model, where it was found and the
 * stories it belongs to, main red and side yellow. Labels and the grid come
 * from [inventory-layout.json](inventory-layout.json) ([schema](inventory-layout.schema.json)).
 * props: { onClose, onQuest( questId )?, preview? } where preview is the
 * ItemPreview it shares with the codex.
 */
export class InventoryView {

	constructor( { onClose, onQuest = () => {}, preview = new ItemPreview( { fallback: layout.detail.preview } ) } ) {

		this.items = [];
		this.selected = - 1;
		this.page = 0;
		this.onQuest = onQuest;
		this.preview = preview;
		this.onScreen = false;

		this.grid = el( 'div', { className: 'inv-grid', role: 'grid' } );
		this.grid.setAttribute( 'aria-label', layout.grid );
		this.grid.style.setProperty( '--inv-columns', layout.columns );
		this.cards = [];
		for ( let row = 0; row < layout.rows; row ++ ) {

			const line = el( 'div', { className: 'inv-row', role: 'row' } );
			for ( let column = 0; column < layout.columns; column ++ ) {

				const card = this.#card( row * layout.columns + column );
				line.append( el( 'div', { className: 'inv-cell', role: 'gridcell' }, card.button ) );
				this.cards.push( card );

			}
			this.grid.append( line );

		}
		this.slots = this.cards.map( ( card ) => card.button );
		this.grid.addEventListener( 'keydown', ( event ) => this.#move( event ) );

		this.count = el( 'span', { className: 'inv-count' } );
		this.gridEmpty = el( 'div', { className: 'inv-grid-empty' },
			el( 'strong', { textContent: layout.empty.title } ),
			el( 'span', { textContent: layout.empty.text } )
		);
		this.pageLabel = el( 'span', { className: 'inv-page-label' } );
		this.previous = this.#pageButton( '←', layout.pages.previous, () => this.#turn( this.page - 1 ) );
		this.next = this.#pageButton( '→', layout.pages.next, () => this.#turn( this.page + 1 ) );
		this.numbers = el( 'div', { className: 'inv-page-numbers' } );
		this.pager = el( 'nav', { className: 'inv-pager' },
			this.pageLabel,
			el( 'div', { className: 'inv-page-controls' }, this.previous, this.numbers, this.next )
		);
		this.pager.setAttribute( 'aria-label', layout.pages.label );

		this.detailName = el( 'h3', { className: 'inv-detail-name' } );
		this.detailText = el( 'p', { className: 'inv-detail-text' } );
		this.hero = el( 'div', { className: 'inv-detail-hero' } );
		this.facts = el( 'dl', { className: 'inv-facts' } );
		this.place = el( 'span', { className: 'inv-found-place' } );
		this.found = el( 'div', { className: 'inv-found' }, el( 'span', { className: 'inv-field-label', textContent: layout.detail.found } ), this.place );
		this.questList = el( 'div', { className: 'inv-quest-links' } );
		this.quests = el( 'section', { className: 'inv-quests' }, el( 'h4', { textContent: layout.detail.quests } ), this.questList );
		this.detail = el( 'aside', { className: 'inv-detail' },
			this.detailName, this.detailText, this.hero, this.facts, this.found, this.quests
		);

		this.header = new PanelHeader( { title: layout.title, onClose } );
		this.element = el( 'div', { className: 'view view-inventory' },
			this.header.element,
			el( 'div', { className: 'inv-body' },
				el( 'section', { className: 'inv-pack' },
					el( 'div', { className: 'inv-pack-heading' }, el( 'h3', { textContent: layout.carried } ), this.count ),
					el( 'div', { className: 'inv-grid-wrap' }, this.grid, this.gridEmpty ),
					this.pager
				),
				this.detail
			)
		);

		this.setItems( [] );

	}

	/**
	 * @param items [{ id, name, kind, description, place, quantity?, facts?: [{ label, value }], quests?: [{ id, title, kind: 'main' | 'side' }], model? }]
	 * in carrying order, a page of the layout's columns by rows at a time; `model`
	 * is the item's own preview model, else the layout draws its kind's shape.
	 */
	setItems( items = [] ) {

		const picked = this.items[ this.selected ]?.id;
		this.items = items;
		const count = items.length;
		this.count.textContent = count === 1 ? layout.countOne : layout.count.replace( '{count}', count );
		this.gridEmpty.hidden = count > 0;
		const index = items.findIndex( ( item ) => item.id === picked );
		this.select( index >= 0 ? index : count ? Math.min( Math.max( this.selected, 0 ), count - 1 ) : - 1 );

	}

	/** Picks one item by its place in the list and turns to its page; -1 clears the pick. */
	select( index ) {

		const item = this.items[ index ];
		this.selected = item ? index : - 1;
		if ( item ) this.page = Math.floor( index / PAGE );
		this.page = Math.max( 0, Math.min( this.page, this.#pages() - 1 ) );
		this.#fill();
		this.#detail( item ?? null );

	}

	/** On screen: the shared stage moves here and draws the picked item and the page's thumbnails. */
	shown() {

		this.onScreen = true;
		this.preview.attach( this.hero );
		this.preview.setVisible( true );
		this.#detail( this.items[ this.selected ] ?? null );
		this.#fill();

	}

	hidden() {

		this.onScreen = false;
		this.preview.setVisible( false );

	}

	#pages() {

		return Math.max( 1, Math.ceil( this.items.length / PAGE ) );

	}

	#turn( page ) {

		const pages = this.#pages();
		if ( page < 0 || page >= pages || page === this.page ) return;
		this.page = page;
		this.#fill();
		this.cards.find( ( card ) => ! card.button.disabled )?.button.focus( { preventScroll: true } );

	}

	#fill() {

		const first = this.page * PAGE;
		this.cards.forEach( ( card, slot ) => this.#show( card, this.items[ first + slot ] ?? null, first + slot ) );
		const focusable = this.cards.find( ( card ) => card.button.getAttribute( 'aria-pressed' ) === 'true' ) ?? this.cards.find( ( card ) => ! card.button.disabled );
		for ( const card of this.cards ) card.button.tabIndex = card === focusable ? 0 : - 1;

		const pages = this.#pages();
		this.pageLabel.textContent = layout.pages.page.replace( '{page}', this.page + 1 ).replace( '{pages}', pages );
		this.previous.disabled = this.page === 0;
		this.next.disabled = this.page >= pages - 1;
		this.pager.hidden = this.items.length === 0;
		const numbers = pageStrip( this.page, pages );
		if ( this.numbers.dataset.pages !== numbers.join() ) {

			this.numbers.dataset.pages = numbers.join();
			this.numbers.replaceChildren( ...numbers.flatMap( ( page, at ) => [
				...( at && page > numbers[ at - 1 ] + 1 ? [ el( 'span', { className: 'inv-page-gap', textContent: '…', ariaHidden: 'true' } ) ] : [] ),
				this.#pageButton( String( page + 1 ), layout.pages.number.replace( '{page}', page + 1 ), () => this.#turn( page ), page )
			] ) );

		}
		for ( const button of this.numbers.querySelectorAll( 'button' ) ) {

			if ( Number( button.dataset.page ) === this.page ) button.setAttribute( 'aria-current', 'page' );
			else button.removeAttribute( 'aria-current' );

		}

	}

	#card( slot ) {

		const image = el( 'img', { className: 'inv-card-image', alt: '', draggable: false } );
		image.hidden = true;
		const name = el( 'span', { className: 'inv-card-name' } );
		const quantity = el( 'span', { className: 'inv-card-quantity' } );
		const check = el( 'span', { className: 'inv-card-check', textContent: '✓', ariaHidden: 'true' } );
		const button = el( 'button', { className: 'inv-slot', type: 'button' },
			el( 'span', { className: 'inv-card-art', ariaHidden: 'true' }, image ),
			name, quantity, check
		);
		button.addEventListener( 'click', () => this.select( this.page * PAGE + slot ) );
		return { button, image, name, quantity, check, id: null, key: null };

	}

	#show( card, item, index ) {

		const selected = Boolean( item ) && index === this.selected;
		card.button.disabled = ! item;
		card.button.classList.toggle( 'is-filled', Boolean( item ) );
		card.button.classList.toggle( 'is-selected', selected );
		card.button.setAttribute( 'aria-pressed', String( selected ) );
		card.button.setAttribute( 'aria-label', item ? `${item.name}${item.quantity > 1 ? `, ×${item.quantity}` : ''}` : layout.emptySlot.replace( '{position}', index + 1 ) );
		if ( card.name.textContent !== ( item?.name ?? '' ) ) card.name.textContent = item?.name ?? '';
		card.quantity.textContent = item?.quantity > 1 ? `×${item.quantity}` : '';
		card.quantity.hidden = ! ( item?.quantity > 1 );
		card.check.hidden = ! selected;

		const model = item ? modelOf( item ) : null;
		const key = model ? JSON.stringify( model ) : null;
		if ( card.id === ( item?.id ?? null ) && card.key === key && ( card.image.src || ! this.onScreen ) ) return;
		card.id = item?.id ?? null;
		card.key = key;
		card.image.hidden = true;
		card.image.removeAttribute( 'src' );
		if ( ! model || ! this.onScreen ) return;
		const id = card.id;
		this.preview.thumbnail( model ).then( ( url ) => {

			if ( ! url || card.id !== id || card.key !== key ) return;
			card.image.src = url;
			card.image.hidden = false;

		} );

	}

	#detail( item ) {

		this.detail.classList.toggle( 'is-empty', ! item );
		this.detailName.textContent = item?.name ?? ( this.items.length ? layout.unselected.title : layout.empty.title );
		this.detailText.textContent = item ? item.description ?? '' : this.items.length ? layout.unselected.text : layout.empty.text;
		this.detailText.hidden = ! this.detailText.textContent;
		this.hero.hidden = ! item;
		if ( this.onScreen ) this.preview.setModel( item ? modelOf( item ) : null, item?.name );

		const facts = item ? [
			...( item.kind ? [ [ layout.detail.kind, item.kind ] ] : [] ),
			...( item.facts ?? [] ).map( ( { label, value } ) => [ label, value ] ),
			...( item.quantity > 1 ? [ [ layout.detail.quantity, String( item.quantity ) ] ] : [] )
		] : [];
		this.facts.replaceChildren( ...facts.map( ( [ label, value ] ) => el( 'div', {}, el( 'dt', { textContent: label } ), el( 'dd', { textContent: value } ) ) ) );
		this.facts.hidden = ! facts.length;
		this.place.textContent = item?.place ?? '';
		this.found.hidden = ! item?.place;

		const quests = item?.quests ?? [];
		this.questList.replaceChildren( ...quests.map( ( quest ) => {

			const kind = quest.kind === 'main' ? 'main' : 'side';
			const button = el( 'button', { className: 'inv-quest', type: 'button' },
				questMark( kind ),
				el( 'span', { className: 'inv-quest-copy' },
					el( 'span', { className: 'inv-quest-kind', textContent: layout.questKinds[ kind ] } ),
					el( 'span', { className: 'inv-quest-title', textContent: quest.title } )
				)
			);
			button.setAttribute( 'aria-label', `${layout.questKinds[ kind ]}: ${quest.title}` );
			button.addEventListener( 'click', () => this.onQuest( quest.id ) );
			return button;

		} ) );
		this.quests.hidden = ! quests.length;

		if ( item && item.id !== this.shownId ) {

			this.detail.classList.remove( 'is-arriving' );
			void this.detail.offsetWidth;
			this.detail.classList.add( 'is-arriving' );

		}
		this.shownId = item?.id ?? null;

	}

	#pageButton( text, label, onClick, page = null ) {

		const button = el( 'button', { className: 'inv-page-button', type: 'button', textContent: text } );
		button.setAttribute( 'aria-label', label );
		if ( page !== null ) button.dataset.page = String( page );
		button.addEventListener( 'click', onClick );
		return button;

	}

	#move( event ) {

		const at = this.slots.indexOf( event.target );
		if ( at < 0 ) return;
		const columns = layout.columns;
		const target = {
			ArrowRight: at + 1, ArrowLeft: at - 1, ArrowDown: at + columns, ArrowUp: at - columns,
			Home: event.ctrlKey ? 0 : at - at % columns, End: event.ctrlKey ? this.slots.length - 1 : at - at % columns + columns - 1
		}[ event.key ];
		if ( target === undefined ) return;
		event.preventDefault();
		const next = this.slots[ Math.max( 0, Math.min( this.slots.length - 1, target ) ) ];
		if ( next.disabled ) return;
		for ( const slot of this.slots ) slot.tabIndex = slot === next ? 0 : - 1;
		next.focus();

	}

}

/** The item's own model, else its kind's shape from [item-shapes.json](item-shapes.json). */
function modelOf( item ) {

	return item.model ?? { shape: shapes[ item.kind ] ?? 'parcel' };

}

/** At most five page numbers: the ends and the pages around the current one. */
function pageStrip( current, count ) {

	if ( count <= 5 ) return Array.from( { length: count }, ( _, page ) => page );
	return [ ...new Set( [ 0, current - 1, current, current + 1, count - 1 ] ) ].filter( ( page ) => page >= 0 && page < count ).sort( ( a, b ) => a - b );

}
