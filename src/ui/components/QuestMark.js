import { el } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const PATHS = {
	main: 'M9 1 17 9 9 17 1 9ZM9 5v5m0 2v1',
	side: 'M5 2h8l4 7-4 7H5L1 9ZM6 9h6M9 6v6'
};

/**
 * What kind of story something belongs to, as the quest data says and never
 * guessed from its words: `main` red, `side` yellow. The only marks drawn as
 * symbols on the inventory and codex screens.
 */
export function questMark( kind ) {

	const svg = document.createElementNS( NS, 'svg' );
	svg.setAttribute( 'class', `quest-mark is-${kind}` );
	svg.setAttribute( 'viewBox', '0 0 18 18' );
	svg.setAttribute( 'aria-hidden', 'true' );
	const path = document.createElementNS( NS, 'path' );
	path.setAttribute( 'd', PATHS[ kind ] ?? PATHS.side );
	svg.append( path );
	return svg;

}

/** The journal's tag: a red MAIN plate, or a yellow diamond for a side job. `labels` names both. */
export function questKind( kind, labels ) {

	const label = labels?.[ kind ];
	const tag = el( 'span', { className: `quest-kind is-${kind}`, textContent: kind === 'main' ? label?.short ?? 'MAIN' : '' } );
	tag.setAttribute( 'role', 'img' );
	tag.setAttribute( 'aria-label', label?.label ?? kind );
	tag.title = label?.label ?? kind;
	return tag;

}
