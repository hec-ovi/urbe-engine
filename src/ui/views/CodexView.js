import { el } from '../components/dom.js';
import { emptyState } from '../components/EmptyState.js';
import { PanelHeader } from '../components/PanelHeader.js';

/**
 * What the player has learned about the city, grouped by category on the
 * left, one entry open on the right. props: { onClose }
 */
export class CodexView {

	constructor( { onClose } ) {

		this.entries = [];
		this.selected = null;

		this.side = el( 'div', { className: 'view-side' } );
		this.main = el( 'div', { className: 'view-main' } );
		this.header = new PanelHeader( { title: 'Codex', key: 'X', onClose } );
		this.element = el( 'div', { className: 'view view-codex' },
			this.header.element,
			el( 'div', { className: 'view-body' }, this.side, this.main )
		);

		this.setEntries( [] );

	}

	/** @param entries [{ id, title, category, text }] */
	setEntries( entries = [] ) {

		this.entries = entries;
		this.side.replaceChildren();

		const groups = new Map();

		for ( const entry of entries ) {

			const key = entry.category ?? 'notes';
			if ( ! groups.has( key ) ) groups.set( key, [] );
			groups.get( key ).push( entry );

		}

		for ( const [ category, list ] of groups ) {

			this.side.append(
				el( 'h3', { className: 'section-title', style: 'padding:14px 16px 0', textContent: category } ),
				el( 'ul', { className: 'list' }, ...list.map( ( entry ) => {

					const button = el( 'button', { className: 'list-row', type: 'button', textContent: entry.title } );
					button.dataset.id = entry.id;
					button.addEventListener( 'click', () => this.select( entry.id ) );

					return el( 'li', {}, button );

				} ) )
			);

		}

		if ( ! entries.length ) this.side.append( emptyState( 'nothing recorded yet' ) );

		this.select( entries.some( ( e ) => e.id === this.selected ) ? this.selected : entries[ 0 ]?.id ?? null );

	}

	select( id ) {

		this.selected = id;
		const entry = this.entries.find( ( e ) => e.id === id );

		this.side.querySelectorAll( '.list-row' ).forEach( ( row ) => {

			const active = row.dataset.id === String( id );
			row.classList.toggle( 'is-active', active );
			row.setAttribute( 'aria-pressed', String( active ) );

		} );

		if ( ! entry ) {

			this.main.replaceChildren( emptyState( 'walk the city, talk to people: what you learn lands here' ) );

			return;

		}

		this.main.replaceChildren(
			el( 'h3', { className: 'detail-title', textContent: entry.title } ),
			el( 'div', { className: 'detail-kind', textContent: entry.category ?? 'notes' } ),
			el( 'p', { className: 'detail-text', textContent: entry.text ?? '' } )
		);

	}

}
