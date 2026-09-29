const NS = 'http://www.w3.org/2000/svg';

/** Stroke paths on a 24 unit grid, one per icon name. */
const PATHS = {
	quests: 'M3 19h18M2 8l5 5 5-8 5 8 5-5-2 11H4z',
	map: 'M9 4l6 2 6-2v14l-6 2-6-2-6 2V6zM9 4v14M15 6v14',
	inventory: 'M3 8h18v11H3zM9 8V5h6v3M3 13h18',
	codex: 'M4 5h6a2 2 0 012 2v13a2 2 0 00-2-2H4zM20 5h-6a2 2 0 00-2 2v13a2 2 0 012-2h6z',
	settings: 'M12 8.5a3.5 3.5 0 100 7 3.5 3.5 0 100-7M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4',
	controls: 'M2 6h20v12H2zM6 10h1M10 10h1M14 10h1M18 10h1M7 14h10',
	leave: 'M10 4H5v16h5M14 8l4 4-4 4M18 12H9',
	send: 'M3 11l18-8-8 18-2-8z',
	close: 'M6 6l12 12M18 6L6 18',
	hangup: 'M3 14c5-5 13-5 18 0l-2 3-4-1v-2a9 9 0 00-6 0v2l-4 1z',
	north: 'M12 3l5 16-5-3-5 3z',
	// Conversation: talking, the kinds of reply and of asking along, the voices.
	talk: 'M4 4h16v12H11l-6 4v-4H4zM7 9h10M7 12h6',
	question: 'M4 4h16v12h-8l-5 4v-4H4zM10 8.5a2 2 0 113 1.7c-1 .6-1 1-1 1.8M12 14h.01',
	commit: 'M12 2l10 10-10 10L2 12zM7.5 12l3 3 6-6',
	follow: 'M8 3a2 2 0 110 4 2 2 0 010-4zM6 21l2-7-3-3 3-3 3 4h3M8 14l5 7M17 5l4 4-4 4M14 9h7',
	lead: 'M7 3a2 2 0 110 4 2 2 0 010-4zM5 21l2-7-2-3 3-3 3 3h5M7 14l5 7M16 7l5 5-5 5',
	dismiss: 'M8 4a3 3 0 110 6 3 3 0 010-6zM3 21v-4a5 5 0 0110 0v4M15 12h7M19 9l3 3-3 3',
	actions: 'M13 2L4 14h7l-1 8 9-12h-7z',
	voice: 'M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11',
	mute: 'M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6'
};

/** An inline SVG icon coloured by the surrounding text. */
export function icon( name ) {

	const svg = document.createElementNS( NS, 'svg' );
	svg.setAttribute( 'class', 'icon' );
	svg.setAttribute( 'viewBox', '0 0 24 24' );
	svg.setAttribute( 'aria-hidden', 'true' );

	const path = document.createElementNS( NS, 'path' );
	path.setAttribute( 'd', PATHS[ name ] );
	svg.append( path );

	return svg;

}
