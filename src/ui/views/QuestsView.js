import { el } from '../components/dom.js';
import { emptyState } from '../components/EmptyState.js';
import { PanelHeader } from '../components/PanelHeader.js';

/**
 * The quest log: every quest on the left, the picked one with its steps on
 * the right. props: { onClose }
 */
export class QuestsView {

	constructor( { onClose } ) {

		this.quests = [];
		this.selected = null;

		this.list = el( 'ul', { className: 'list' } );
		this.side = el( 'div', { className: 'view-side' }, this.list );
		this.main = el( 'div', { className: 'view-main' } );
		this.header = new PanelHeader( { title: 'Quests', key: 'J', onClose } );
		this.element = el( 'div', { className: 'view view-quests' },
			this.header.element,
			el( 'div', { className: 'view-body' }, this.side, this.main )
		);

		this.setQuests( [] );

	}

	/** @param quests [{ id, title, text, state: 'active' | 'done' | 'failed', steps: [{ text, done }] }] */
	setQuests( quests = [] ) {

		this.quests = quests;
		this.list.replaceChildren( ...quests.map( ( quest ) => {

			const row = el( 'li', {}, el( 'button', { className: 'list-row', type: 'button' },
				el( 'span', { textContent: quest.title } ),
				el( 'span', { className: `badge is-${quest.state ?? 'active'}`, textContent: quest.state ?? 'active' } )
			) );
			row.firstChild.addEventListener( 'click', () => this.select( quest.id ) );

			return row;

		} ) );

		if ( ! quests.length ) this.list.append( el( 'li', {}, emptyState( 'no quest yet' ) ) );

		this.select( quests.some( ( q ) => q.id === this.selected ) ? this.selected : quests[ 0 ]?.id ?? null );

	}

	select( id ) {

		this.selected = id;
		const quest = this.quests.find( ( q ) => q.id === id );

		this.list.querySelectorAll( '.list-row' ).forEach( ( row, i ) => {

			row.classList.toggle( 'is-active', this.quests[ i ]?.id === id );

		} );

		if ( ! quest ) {

			this.main.replaceChildren( emptyState( 'ask around: somebody in the city has work for you' ) );

			return;

		}

		this.main.replaceChildren(
			el( 'h3', { className: 'detail-title', textContent: quest.title } ),
			el( 'div', { className: 'detail-kind', textContent: quest.state ?? 'active' } ),
			el( 'p', { className: 'detail-text', textContent: quest.text ?? '' } ),
			el( 'ul', { className: 'quest-steps' }, ...( quest.steps ?? [] ).map( ( step ) => el( 'li', {
				className: `quest-step${step.done ? ' is-done' : ''}`
			}, el( 'span', { className: 'quest-step-mark' } ), el( 'span', { textContent: step.text } ) ) ) )
		);

	}

}
