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
	microphone: 'M9 5a3 3 0 016 0v6a3 3 0 01-6 0zM5 10v1a7 7 0 0014 0v-1M12 18v3M8 21h8',
	close: 'M6 6l12 12M18 6L6 18',
	hangup: 'M3 14c5-5 13-5 18 0l-2 3-4-1v-2a9 9 0 00-6 0v2l-4 1z',
	north: 'M12 3l5 16-5-3-5 3z'
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
