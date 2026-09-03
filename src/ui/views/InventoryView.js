import { el } from '../components/dom.js';
import { emptyState } from '../components/EmptyState.js';
import { PanelHeader } from '../components/PanelHeader.js';

const SLOTS = 30;

/**
 * What the player carries: a 30 slot grid and the detail of the picked slot.
 * Presentation only: setItems and select are the whole input. props: { onClose }
 */
export class InventoryView {

	constructor( { onClose } ) {

		this.items = [];
		this.selected = - 1;
		this.slots = [];

		const grid = el( 'div', { className: 'inv-grid' } );

		for ( let i = 0; i < SLOTS; i ++ ) {

			const slot = el( 'button', { className: 'inv-slot', type: 'button' } );
			slot.setAttribute( 'aria-label', `slot ${i + 1}` );
			slot.addEventListener( 'click', () => this.select( i ) );
			this.slots.push( slot );
			grid.append( slot );

		}

		this.note = el( 'div', { className: 'inv-note' } );
		this.detail = el( 'div', { className: 'inv-detail' } );
		this.header = new PanelHeader( { title: 'Inventory', key: 'I', onClose } );
		this.element = el( 'div', { className: 'view view-inventory' },
			this.header.element,
			el( 'div', { className: 'view-body' },
				el( 'div', { className: 'view-main' }, grid, this.note ),
				this.detail
			)
		);

		this.setItems( [] );

	}

	/** @param items [{ id, name, kind, description, place }] in slot order; missing slots stay empty. */
	setItems( items = [] ) {

		this.items = items;

		this.slots.forEach( ( slot, i ) => {

			slot.textContent = items[ i ]?.name ?? '';
			slot.setAttribute( 'aria-label', items[ i ]?.name ?? `slot ${i + 1}` );
			slot.classList.toggle( 'is-filled', Boolean( items[ i ] ) );

		} );

		this.note.textContent = items.length ? `${items.length} of ${SLOTS} slots carried` : 'nothing carried yet';
		this.select( items[ this.selected ] ? this.selected : - 1 );

	}

	/** Highlights one slot and shows its item; -1 clears the pick. */
	select( index ) {

		this.selected = index;
		this.slots.forEach( ( slot, i ) => {

			const selected = i === index;
			slot.classList.toggle( 'is-selected', selected );
			slot.setAttribute( 'aria-pressed', String( selected ) );

		} );

		const item = this.items[ index ];

		if ( ! item ) {

			this.detail.replaceChildren( emptyState( index < 0 ? 'pick a slot to see what it holds' : 'empty slot' ) );

			return;

		}

		this.detail.replaceChildren(
			el( 'h3', { className: 'detail-title', textContent: item.name } ),
			el( 'div', { className: 'detail-kind', textContent: item.kind ?? '' } ),
			el( 'p', { className: 'detail-text', textContent: item.description ?? '' } ),
			el( 'div', { className: 'detail-row' },
				el( 'span', { className: 'detail-key', textContent: 'found at' } ),
				el( 'span', { textContent: item.place ?? 'unknown' } )
			)
		);

	}

}
