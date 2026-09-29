import { el } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';

/**
 * The four letters on a 100 × 140 grid. Stems and bars differ in weight (the
 * U's left stem is half its right one, the E's middle bar the thinnest), so
 * the mark reads fractured before any band is shifted.
 */
const GLYPHS = [
	'M0 0H12V99Q12 126 49 126Q77 126 77 99V0H100V99Q100 140 49 140Q0 140 0 99Z',
	'M0 0H55Q100 0 100 44Q100 74 73 82L106 140H77L45 85H12V140H0ZM12 13V72H52Q85 72 85 43Q85 13 52 13Z',
	'M0 0H54Q97 0 97 36Q97 59 79 67Q101 77 101 104Q101 140 55 140H0ZM12 12V60H51Q83 60 83 37Q83 12 51 12ZM12 78V115H53Q75 115 75 98Q75 78 53 78Z',
	'M0 0H100V12H12V61H88V72H12V116H100V140H0Z'
];

/**
 * The wordmark in its box: every layer is the same drawing over the whole box,
 * clipped to a horizontal band and moved sideways. Bands and cuts are in
 * `fracture.css`; only the number of cuts lives here.
 */
const BANDS = [ 'top', 'mid', 'bottom' ];
const CUTS = 6;

let drawing = null;

/** One copy of the letters, cloned for each layer. */
function letters() {

	if ( ! drawing ) {

		drawing = document.createElementNS( NS, 'svg' );
		drawing.setAttribute( 'viewBox', '105 135 605 178' );
		drawing.setAttribute( 'preserveAspectRatio', 'none' );
		drawing.setAttribute( 'aria-hidden', 'true' );
		drawing.setAttribute( 'focusable', 'false' );
		const group = document.createElementNS( NS, 'g' );
		group.setAttribute( 'transform', 'translate(123 143) scale(1.2232 1.1357)' );
		group.setAttribute( 'fill', 'currentColor' );
		group.setAttribute( 'fill-rule', 'evenodd' );
		GLYPHS.forEach( ( d, index ) => {

			const path = document.createElementNS( NS, 'path' );
			path.setAttribute( 'd', d );
			if ( index ) path.setAttribute( 'transform', `translate(${index * 116} 0)` );
			group.append( path );

		} );
		drawing.append( group );

	}

	return drawing.cloneNode( true );

}

/**
 * The Fracture wordmark: "URBE" cut into three shifted bands, with a faint
 * ghost of its middle band and, unless `glitch` is false, six thin cuts that
 * jump sideways now and then. Every movement is a CSS transform or opacity
 * step, so it runs on the compositor while the main thread is busy loading.
 * `backed` paints each cut over the screen's own colour (`--fracture-backing`),
 * hiding the letters it displaces; without it a cut doubles them instead.
 * The mark is one image named `label`; remove the element to dispose of it.
 */
export function fractureLogo( { label = 'urbe', glitch = true, backed = false } = {} ) {

	const layer = ( className, ...children ) => el( 'span', { className }, ...children );
	const element = el( 'span', { className: 'fracture' },
		layer( 'fracture-layer fracture-ghost', letters() ),
		...BANDS.map( ( band ) => layer( `fracture-layer fracture-band fracture-band-${band}`, letters() ) ),
		...( glitch ? Array.from( { length: CUTS }, ( _, index ) => layer( `fracture-layer fracture-cut fracture-cut-${index + 1}`,
			layer( 'fracture-shift', letters() ),
			index % 4 === 0 ? layer( 'fracture-shift fracture-shift-ghost', letters() ) : ''
		) ) : [] )
	);
	element.setAttribute( 'role', 'img' );
	element.setAttribute( 'aria-label', label );
	if ( backed ) element.classList.add( 'is-backed' );

	return element;

}
