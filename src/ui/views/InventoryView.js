import { el } from '../components/dom.js';

const SLOTS = 30;

/**
 * The player's inventory. The grid and the panel are here; what goes in the
 * slots comes from the quest layer, so every slot is empty until items are
 * wired up. Presentation only: `setItems` is the whole input.
 */
export class InventoryView {

	constructor() {

		this.slots = [];
		const grid = el( 'div', { className: 'hud-inventory-grid' } );

		for ( let i = 0; i < SLOTS; i ++ ) {

			const slot = el( 'div', { className: 'hud-inventory-slot' } );
			this.slots.push( slot );
			grid.append( slot );

		}

		this.note = el( 'div', { className: 'hud-inventory-note', textContent: 'empty' } );
		this.element = el( 'div', { className: 'hud-inventory' },
			el( 'div', { className: 'hud-inventory-title', textContent: 'Inventory' } ),
			grid,
			this.note
		);

		this.setVisible( false );

	}

	/** @param items [{ name }] in slot order; missing slots stay empty. */
	setItems( items = [] ) {

		this.slots.forEach( ( slot, i ) => {

			slot.textContent = items[ i ]?.name ?? '';
			slot.classList.toggle( 'is-filled', Boolean( items[ i ] ) );

		} );

		this.note.textContent = items.length ? `${items.length} carried` : 'empty';

	}

	toggle() {

		this.setVisible( this.element.hidden );

	}

	setVisible( visible ) {

		this.element.hidden = ! visible;

	}

}
