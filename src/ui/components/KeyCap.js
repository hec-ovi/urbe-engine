import { el } from './dom.js';

/** A keyboard key drawn as a small framed label. */
export function keyCap( text ) {

	return el( 'kbd', { className: 'keycap', textContent: text } );

}
