import { el } from '../components/dom.js';
import { emptyState } from '../components/EmptyState.js';
import { PanelHeader } from '../components/PanelHeader.js';

/**
 * The quest log: every quest on the left, the picked one with its steps on
 * the right. props: { onClose, onSelect }
 */
export class QuestsView {

	constructor( { onClose, onSelect = () => {} } = {} ) {

		this.quests = [];
		this.selected = null;
		this.onSelect = onSelect;

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

	/**
	 * @param quests [{ id, title, text, note, state: 'available' | 'active' | 'blocked' | 'done' | 'failed',
	 * steps: [{ text, done, npcName, place, availability, window }] }]
	 */
	setQuests( quests = [] ) {

		this.quests = quests;
		this.list.replaceChildren( ...quests.map( ( quest ) => {

			const row = el( 'li', {}, el( 'button', { className: 'list-row', type: 'button' },
				el( 'span', { textContent: quest.title } ),
				el( 'span', { className: `badge is-${quest.state ?? 'active'}`, textContent: quest.state ?? 'active' } )
			) );
			row.firstChild.addEventListener( 'click', () => {

				this.select( quest.id );
				this.onSelect( quest.id );

			} );

			return row;

		} ) );

		if ( ! quests.length ) this.list.append( el( 'li', {}, emptyState( 'no quest yet' ) ) );

		this.select( quests.some( ( q ) => q.id === this.selected ) ? this.selected : quests[ 0 ]?.id ?? null );

	}

	select( id ) {

		this.selected = id;
		const quest = this.quests.find( ( q ) => q.id === id );

		this.list.querySelectorAll( '.list-row' ).forEach( ( row, i ) => {

			const active = this.quests[ i ]?.id === id;
			row.classList.toggle( 'is-active', active );
			row.setAttribute( 'aria-pressed', String( active ) );

		} );

		if ( ! quest ) {

			this.main.replaceChildren( emptyState( 'ask around: somebody in the city has work for you' ) );

			return;

		}

		this.main.replaceChildren(
			el( 'h3', { className: 'detail-title', textContent: quest.title } ),
			el( 'div', { className: 'detail-kind', textContent: quest.state ?? 'active' } ),
			el( 'p', { className: 'detail-text', textContent: quest.text ?? '' } ),
			...( quest.note ? [ el( 'p', { className: 'detail-note', textContent: quest.note } ) ] : [] ),
			el( 'ul', { className: 'quest-steps' }, ...( quest.steps ?? [] ).map( stepRow ) )
		);

	}

}

/** One step: what to do, who it is about and where, and why it is closed now. */
function stepRow( step ) {

	const meta = [ step.npcName, step.place?.name ].filter( Boolean ).join( ' - ' );
	const closed = step.availability && step.availability.available === false;
	const hours = hoursLine( step.window );

	return el( 'li', { className: `quest-step${step.done ? ' is-done' : ''}${closed ? ' is-closed' : ''}` },
		el( 'span', { className: 'quest-step-mark' } ),
		el( 'span', { className: 'quest-step-body' },
			el( 'span', { textContent: step.text } ),
			...( meta ? [ el( 'span', { className: 'quest-step-meta', textContent: meta } ) ] : [] ),
			...( closed && step.availability.text
				? [ el( 'span', { className: 'quest-step-closed', textContent: step.availability.text } ) ] : [] ),
			...( hours ? [ el( 'span', { className: 'quest-step-meta', textContent: hours } ) ] : [] )
		)
	);

}

/** "Open during the slow hour, 18:00 to 23:00": the step's own words, and the clock. */
function hoursLine( window ) {

	const label = window?.label?.trim?.() || '';
	if ( ! label || ! Number.isFinite( window.startMin ) || ! Number.isFinite( window.endMin ) ) return '';
	return `Open ${label}, ${clock( window.startMin )} to ${clock( window.endMin )}`;

}

function clock( minuteOfDay ) {

	const hours = Math.floor( minuteOfDay / 60 ) % 24;
	return `${String( hours ).padStart( 2, '0' )}:${String( minuteOfDay % 60 ).padStart( 2, '0' )}`;

}
