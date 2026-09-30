import { el } from '../components/dom.js';
import layout from './transit-layout.json' with { type: 'json' };
import '../components/transit.css';

const noop = () => {};

/** Aboard line readout and an explicit picker when several vehicles are boarding. */
export class TransitHud {

	constructor( { onSelect = noop, onCancel = noop } = {} ) {

		this.onSelect = onSelect;
		this.onCancel = onCancel;
		this.rideText = el( 'strong', { className: 'transit-ride-text' } );
		this.status = el( 'div', { className: 'hud-transit-status', role: 'status', ariaLive: 'polite' },
			el( 'span', { className: 'transit-ride-code', textContent: '↗', ariaHidden: 'true' } ),
			el( 'div', { className: 'transit-ride-copy' }, el( 'span', { className: 'transit-eyebrow', textContent: 'ON BOARD' } ), this.rideText ) );
		this.status.hidden = true;
		this.title = el( 'h2', { className: 'hud-transit-title', textContent: layout.titles.service } );
		this.count = el( 'span', { className: 'transit-choice-count' } );
		this.empty = el( 'p', { className: 'transit-choice-empty', textContent: 'No services are available here.', role: 'status' } );
		this.options = el( 'div', { className: 'hud-transit-options' } );
		this.cancel = el( 'button', { className: 'hud-button', type: 'button', textContent: layout.cancel } );
		this.cancel.addEventListener( 'click', () => this.#cancel() );
		this.chooser = el( 'section', {
			className: 'hud-transit-chooser',
			role: 'dialog',
			tabIndex: -1,
			ariaModal: 'true',
			ariaLabel: layout.titles.service
		}, el( 'header', { className: 'transit-choice-heading' }, el( 'span', { className: 'transit-eyebrow', textContent: 'CITY TRANSIT' } ),
			el( 'div', {}, this.title, this.count ) ), this.options, this.empty,
			el( 'footer', { className: 'transit-choice-footer' }, this.cancel, el( 'span', { textContent: '↑ ↓ / SELECT   ENTER / TRAVEL' } ) ) );
		this.chooser.hidden = true;
		this.chooser.addEventListener( 'keydown', ( event ) => {

			if ( event.key === 'Escape' ) { event.preventDefault(); event.stopPropagation(); this.#cancel(); return; }
			const buttons = [ ...this.options.querySelectorAll( 'button' ), this.cancel ];
			const index = buttons.indexOf( document.activeElement );
			if ( [ 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab' ].includes( event.key ) ) {
				event.preventDefault();
				const backwards = event.key === 'ArrowUp' || event.shiftKey;
				const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
					: index < 0 ? ( backwards ? buttons.length - 1 : 0 )
						: ( index + ( backwards ? -1 : 1 ) + buttons.length ) % buttons.length;
				buttons[ next ].focus();
			}

		} );
		this.element = el( 'div', {}, this.status, this.chooser );

	}

	get open() {

		return ! this.chooser.hidden;

	}

	/** @param options [{ id, label, value }] */
	choose( options, mode = 'service' ) {

		this.title.textContent = layout.titles[ mode ];
		this.chooser.dataset.mode = mode;
		this.count.textContent = String( options.length ).padStart( 2, '0' );
		this.empty.textContent = mode === 'destination' ? 'No destinations are available here.' : 'No services are available here.';
		this.empty.hidden = options.length > 0;
		this.chooser.setAttribute( 'aria-label', layout.titles[ mode ] );

		const buttons = options.map( ( option, index ) => {

			const button = el( 'button', {
				className: 'hud-transit-option', type: 'button', ariaLabel: option.label
			}, el( 'span', { className: 'transit-choice-code', textContent: option.code ?? String( index + 1 ).padStart( 2, '0' ), ariaHidden: 'true' } ),
			el( 'span', { className: 'transit-choice-copy' }, el( 'span', { textContent: option.label } ),
				...( option.detail ? [ el( 'span', { className: 'transit-choice-detail', textContent: option.detail } ) ] : [] ) ),
			el( 'span', { className: 'transit-choice-arrow', textContent: '↗', ariaHidden: 'true' } ) );
			button.addEventListener( 'click', () => {

				this.close();
				this.onSelect( option.value );

			} );
			return button;

		} );
		this.options.replaceChildren( ...buttons );
		this.chooser.hidden = false;
		( buttons[ 0 ] ?? this.cancel ).focus();

	}

	close() {

		this.chooser.hidden = true;
		this.options.replaceChildren();

	}

	ride( text ) {

		this.status.hidden = ! text;
		if ( this.rideText.textContent !== ( text ?? '' ) ) this.rideText.textContent = text ?? '';

	}

	#cancel() {

		this.close();
		this.onCancel();

	}

}
