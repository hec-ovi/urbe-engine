import { el } from './dom.js';

/** One quiet line where a list has nothing to show yet. */
export function emptyState( text ) {

	return el( 'div', { className: 'empty', textContent: text } );

}
