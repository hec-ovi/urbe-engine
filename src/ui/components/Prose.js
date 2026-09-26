import { el } from './dom.js';

/** Story text as reading paragraphs, a blank line between two, for a container of class `prose`. */
export function prose( text ) {

	return String( text ?? '' ).split( /\n\s*\n/ ).map( ( part ) => part.trim() ).filter( Boolean )
		.map( ( paragraph ) => el( 'p', { className: 'detail-text', textContent: paragraph } ) );

}
