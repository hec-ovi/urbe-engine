const NS = 'http://www.w3.org/2000/svg';

/**
 * The dock's line glyphs on a 24 unit grid: each a light outline and one
 * heavier stroke, so the set reads as one family at 24 px. `fracture` is the
 * wordmark's U, the dock's own mark.
 */
const GLYPHS = {
	play: [ [ 'M4 11.5 12 4l8 7.5M6.5 10v10h11V10M10 20v-6h4v6' ], [ 'M17 4.5v3', 2.5 ] ],
	QUESTS: [ [ 'M6.5 4.5H19v16H6.5A2.5 2.5 0 0 1 4 18V7a2.5 2.5 0 0 1 2.5-2.5ZM4 17.5h15M8 4.5v13M11.5 9H16M11.5 12H15' ], [ 'M12 3v3.5', 2.5 ] ],
	MAP: [ [ 'm3.5 6 5-2 7 2 5-2v14l-5 2-7-2-5 2V6ZM8.5 4v14M15.5 6v14' ], [ 'm11 11 2 1.5-2 1.5', 2.3 ] ],
	INVENTORY: [ [ 'm5 8 7-4 7 4v10l-7 4-7-4V8Zm0 0 7 4 7-4M12 12v10M8.5 6l7 4v4' ], [ 'm8 9.7 4 2.3', 2.5 ] ],
	CODEX: [ [ 'M12 6v14M3.5 4.5 12 7l8.5-2.5v14L12 21l-8.5-2.5v-14ZM6.5 9l2.5.7M6.5 12l2.5.7M15 9.7l2.5-.7M15 12.7l2.5-.7' ], [ 'M12 3v3', 2.5 ] ],
	SETTINGS: [ [ 'm10 3-.5 2.5-2 .9L5 5.5 3 9l1.8 1.6v2.8L3 15l2 3.5 2.5-.9 2 .9.5 2.5h4l.5-2.5 2-.9 2.5.9 2-3.5-1.8-1.6v-2.8L21 9l-2-3.5-2.5.9-2-.9L14 3h-4Z' ], [ 'M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6Z', 2.1 ] ],
	CONTACTS: [ [ 'M6 3.5h11.5a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H6ZM8.5 17c.6-2.4 2-3.5 3.8-3.5s3.2 1.1 3.8 3.5M19 8h2M19 12h2M19 16h2' ], [ 'M12.3 7.5a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 1 0 0-4.6Z', 2.1 ] ],
	LEAVE: [ [ 'M10.5 4.5H5v15h5.5M10 12h10' ], [ 'm16.5 8.5 3.5 3.5-3.5 3.5', 2.3 ] ],
	CONTROLS: [ [ 'M9 8a3 3 0 0 1 6 0c0 2-3 2-3 4M8 3H4v4M16 3h4v4M4 17v4h4M20 17v4h-4' ], [ 'M12 16v.2', 2.8 ] ],
	fracture: [ [ 'M3 3v13l6 5h5', 1.2 ], [ 'M7 4v11l4 3h3', 3.6 ], [ 'M20 3v9l-4 4M20 16l-4 5', 2.4 ] ]
};

/** An inline glyph coloured by the text around it; unknown names throw. */
export function dockIcon( name, size = 24 ) {

	const glyph = GLYPHS[ name ];
	if ( ! glyph ) throw new TypeError( `unknown dock icon: ${name}` );
	const svg = document.createElementNS( NS, 'svg' );
	svg.setAttribute( 'class', 'dock-icon' );
	svg.setAttribute( 'viewBox', '0 0 24 24' );
	svg.setAttribute( 'width', String( size ) );
	svg.setAttribute( 'height', String( size ) );
	svg.setAttribute( 'aria-hidden', 'true' );
	for ( const [ d, width = 1.35 ] of glyph ) {

		const path = document.createElementNS( NS, 'path' );
		path.setAttribute( 'd', d );
		path.setAttribute( 'stroke-width', String( width ) );
		svg.append( path );

	}
	return svg;

}
