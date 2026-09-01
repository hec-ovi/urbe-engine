import { el } from './dom.js';

/** Plain action button; flash(text) shows a short confirmation. */
export class Button {

	constructor( { label, onClick } ) {

		this.label = label;
		this.element = el( 'button', { className: 'button', textContent: label } );
		this.element.addEventListener( 'click', onClick );

	}

	flash( text ) {

		this.element.textContent = text;
		setTimeout( () => { this.element.textContent = this.label; }, 1200 );

	}

}
