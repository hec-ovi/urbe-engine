import { el } from '../components/dom.js';

const noop = () => {};

/** Aboard line readout and an explicit picker when several vehicles are boarding. */
export class TransitHud {

	constructor( { onSelect = noop, onCancel = noop } = {} ) {

		this.onSelect = onSelect;
		this.onCancel = onCancel;
		this.status = el( 'div', { className: 'hud-transit-status', ariaLive: 'polite' } );
		this.status.hidden = true;
		this.title = el( 'h2', { className: 'hud-transit-title', textContent: 'Choose a service' } );
		this.options = el( 'div', { className: 'hud-transit-options' } );
		this.cancel = el( 'button', { className: 'hud-button', type: 'button', textContent: 'cancel' } );
		this.cancel.addEventListener( 'click', () => this.#cancel() );
		this.chooser = el( 'section', {
			className: 'hud-transit-chooser',
			role: 'dialog',
			ariaModal: 'true',
			ariaLabel: 'Choose a service'
		}, this.title, this.options, this.cancel );
		this.title.id = 'transit-choice-title';
		this.chooser.hidden = true;
		this.chooser.addEventListener( 'keydown', ( event ) => {

			if ( event.key === 'Escape' ) this.#cancel();

		} );
		this.element = el( 'div', {}, this.status, this.chooser );

	}

	get open() {

		return ! this.chooser.hidden;

	}

	/** @param options [{ id, label, value }] */
	choose( options ) {

		const buttons = options.map( ( option ) => {

			const button = el( 'button', {
				className: 'hud-transit-option', type: 'button', textContent: option.label
			} );
			button.addEventListener( 'click', () => {

				this.close();
				this.onSelect( option.value );

			} );
			return button;

		} );
		this.options.replaceChildren( ...buttons );
		this.chooser.hidden = false;
		buttons[ 0 ]?.focus();

	}

	close() {

		this.chooser.hidden = true;
		this.options.replaceChildren();

	}

	ride( text ) {

		this.status.hidden = ! text;
		this.status.textContent = text ?? '';

	}

	#cancel() {

		this.close();
		this.onCancel();

	}

}
