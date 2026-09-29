import { el } from '../components/dom.js';
import { fractureLogo } from '../components/FractureLogo.js';
import layout from './loading-layout.json' with { type: 'json' };

const NS = 'http://www.w3.org/2000/svg';
const TAU = Math.PI * 2;

/** Stroked digits on a 40 × 60 grid; each shows in three shifted fragments. */
const DIGITS = {
	0: 'M20 4C10 4 5 10 5 20V40C5 50 10 56 20 56C30 56 35 50 35 40V20C35 10 30 4 20 4Z',
	1: 'M10 14L21 4V56',
	2: 'M5 16C5 9 11 4 20 4C29 4 35 9 35 16C35 23 30 28 22 35L5 50V56H36',
	3: 'M6 8C10 5 14 4 20 4C29 4 35 9 35 17C35 24 29 29 20 29H15M20 29C30 29 36 34 36 42C36 50 29 56 20 56C13 56 8 53 5 49',
	4: 'M29 56V4H25L4 38V41H37',
	5: 'M35 4H7L5 28H21C30 28 36 33 36 42C36 50 29 56 20 56C13 56 8 53 5 49',
	6: 'M33 9C29 5 25 4 20 4C10 4 5 12 5 25V40C5 50 11 56 20 56C29 56 35 50 35 41C35 32 29 27 20 27C13 27 8 30 5 36',
	7: 'M4 4H36V8L13 56',
	8: 'M20 29C10 29 5 35 5 42C5 50 11 56 20 56C29 56 35 50 35 42C35 35 30 29 20 29C11 29 6 24 6 17C6 9 12 4 20 4C28 4 34 9 34 17C34 24 29 29 20 29',
	9: 'M7 51C11 55 15 56 20 56C30 56 35 48 35 35V20C35 10 29 4 20 4C11 4 5 10 5 19C5 28 11 33 20 33C27 33 32 30 35 24'
};
const BANDS = [ 'top', 'mid', 'bottom' ];

/**
 * Every step and pass the load names, in load order, with the milestone it
 * falls under and its share of the percentage. `#` in a label stands for a
 * number ("loading # buildings").
 */
const SEQUENCE = [];
let WEIGHT = 0;
layout.milestones.forEach( ( milestone, index ) => {

	for ( const step of milestone.steps ) {

		const { match, weight } = typeof step === 'string' ? { match: step, weight: 1 } : step;
		const source = match.split( '#' ).map( ( part ) => part.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ) ).join( '\\d+' );
		SEQUENCE.push( { milestone: index, pattern: new RegExp( `^${source}$` ), start: WEIGHT, weight } );
		WEIGHT += weight;

	}

} );
/** Each milestone's first and last entry in the sequence. */
const SPANS = layout.milestones.map( ( _, index ) => {

	const entries = SEQUENCE.flatMap( ( entry, at ) => entry.milestone === index ? [ at ] : [] );
	return { first: entries[ 0 ], last: entries.at( - 1 ) };

} );

/**
 * The loading screen: the Fracture logo, a turning crystal in a dial that
 * fills with the load, the game's name under it, the percentage in fragmented
 * digits, the work units, a bar, the four milestones as checks and the line
 * naming what loads now. The load runs on the main thread and reports only
 * now and then, so every movement is a CSS transform or opacity keyframe the
 * compositor plays on its own, and a report writes only what it changed.
 *
 * `step(text, progress?)` takes the loader's line and its record
 * `{ label, step, done, total, part }` (LoadProgress); the percentage follows
 * the steps and passes of [loading-layout.json](loading-layout.json), each
 * with its weight, filled by the work units done since it began, and never
 * goes back. `setPlace(name)` names the game under the crystal, `ready()` fills it
 * and hides it, `fail(message)` shows it again with the reason.
 */
export class LoadingScreen {

	constructor() {

		this.index = - 1;
		this.fraction = 0;
		this.base = 0;
		this.value = - 1;
		this.label = null;
		this.units = null;

		this.logo = fractureLogo( { label: layout.title, backed: true } );
		this.title = el( 'h1', { className: 'hud-loading-title' }, this.logo );
		this.core = this.#core();
		this.place = el( 'h2', { className: 'hud-loading-place', hidden: true } );
		this.digits = new Digits();
		this.count = el( 'div', { className: 'hud-loading-units' } );
		this.fill = el( 'span', { className: 'hud-loading-bar-fill' } );
		this.bar = el( 'div', { className: 'hud-loading-bar' }, this.fill );
		for ( const [ name, value ] of [ [ 'role', 'progressbar' ], [ 'aria-label', layout.progress ], [ 'aria-valuemin', '0' ], [ 'aria-valuemax', '100' ], [ 'aria-valuenow', '0' ] ] ) {

			this.bar.setAttribute( name, value );

		}
		this.milestones = layout.milestones.map( ( milestone, index ) => new Milestone( milestone, index ) );
		const row = el( 'ol', { className: 'hud-loading-milestones' }, ...this.milestones.map( ( milestone ) => milestone.element ) );
		row.setAttribute( 'aria-label', layout.milestonesLabel );
		this.line = el( 'div', { className: 'hud-loading-step', textContent: layout.starting } );
		this.error = el( 'div', { className: 'hud-loading-error', hidden: true } );

		this.element = el( 'div', { className: 'hud-loading' },
			el( 'div', { className: 'hud-loading-card' },
				this.title,
				this.core.element,
				this.place,
				el( 'div', { className: 'hud-loading-counter' }, this.digits.element, el( 'span', { className: 'hud-loading-percent', textContent: '%' } ) ),
				this.count,
				this.bar,
				row,
				this.line,
				this.error
			)
		);
		this.element.dataset.state = 'loading';
		this.#render( 0 );

	}

	/** The loader's line, and with it the record that moves the percentage and the milestones. */
	step( text, progress = null ) {

		const label = progress?.label ?? text;
		if ( label !== this.label ) this.line.textContent = this.label = label;
		if ( progress ) {

			const units = progress.total ? `${progress.done} / ${progress.total} ${layout.units}` : '';
			if ( units !== this.units ) this.count.textContent = this.units = units;

		}
		this.#advance( progress ?? { label: text, step: text } );

	}

	/** The game's or city's name under the crystal, in the logo's fractured style; empty hides it. */
	setPlace( name ) {

		const text = typeof name === 'string' ? name.replace( /\s+/g, ' ' ).trim() : '';
		this.place.hidden = ! text;
		this.place.setAttribute( 'aria-label', text );
		const space = text.indexOf( ' ' );
		const split = space >= 0 ? space + 1 : Math.ceil( text.length / 2 );
		this.place.replaceChildren( ...BANDS.map( ( band ) => {

			const copy = el( 'span', { className: `hud-loading-place-band hud-loading-place-${band}` },
				el( 'span', { className: 'hud-loading-place-light', textContent: text.slice( 0, split ) } ),
				el( 'span', { className: 'hud-loading-place-strong', textContent: text.slice( split ) } )
			);
			copy.setAttribute( 'aria-hidden', 'true' );
			return copy;

		} ) );

	}

	ready() {

		this.#render( 1 );
		this.element.dataset.state = 'ready';
		this.logo.classList.add( 'is-still' );
		this.element.hidden = true;

	}

	fail( message ) {

		this.element.hidden = false;
		this.element.dataset.state = 'error';
		this.logo.classList.add( 'is-still' );
		this.line.textContent = this.label = layout.failed;
		this.error.hidden = false;
		this.error.textContent = message;

	}

	/**
	 * Moves to the entry the report names, or the step it runs under, never
	 * back, and fills the entry by the units done since it began of those
	 * still to do: a pass that runs once per group restarts its own counter,
	 * the whole load's does not.
	 */
	#advance( { label, step, done, total } ) {

		const named = SEQUENCE.findIndex( ( entry ) => entry.pattern.test( label ) );
		const index = named >= 0 ? named : SEQUENCE.findIndex( ( entry ) => entry.pattern.test( step ) );
		if ( index < 0 || index < this.index ) return;
		if ( index > this.index ) {

			this.index = index;
			this.fraction = 0;
			this.base = done ?? 0;

		}
		if ( total > this.base ) this.fraction = Math.max( this.fraction, Math.min( 1, ( done - this.base ) / ( total - this.base ) ) );
		const entry = SEQUENCE[ index ];
		this.#render( Math.min( 0.99, ( entry.start + entry.weight * this.fraction ) / WEIGHT ) );

	}

	/** Writes what a new value changes: the digits, the bar, the dial and the milestones. */
	#render( value ) {

		const percent = Math.floor( value * 100 );
		if ( percent === this.value && this.index === this.shown ) return;
		this.shown = this.index;
		if ( percent !== this.value ) {

			this.value = percent;
			this.digits.set( String( percent ).padStart( 2, '0' ) );
			this.bar.setAttribute( 'aria-valuenow', String( percent ) );
			this.fill.style.transform = `scaleX(${value})`;
			this.core.arc.setAttribute( 'stroke-dashoffset', String( 100 - percent ) );

		}
		const done = value >= 1;
		let active = - 1;
		this.milestones.forEach( ( milestone, index ) => {

			const { first, last } = SPANS[ index ];
			const state = done || this.index > last ? 'done' : this.index >= first ? 'active' : 'pending';
			if ( state === 'active' ) active = index;
			const start = SEQUENCE[ first ].start, end = SEQUENCE[ last ].start + SEQUENCE[ last ].weight;
			milestone.set( state, Math.min( 1, Math.max( 0, ( value * WEIGHT - start ) / ( end - start ) ) ) );

		} );
		// Moving on to a milestone jolts the crystal: a glitch, never a fade.
		if ( active !== this.active ) {

			if ( this.active !== undefined ) this.core.element.dataset.jolt = this.core.element.dataset.jolt === 'a' ? 'b' : 'a';
			this.active = active;

		}

	}

	/** The dial, two turning arcs, the orbit and the crystal; only the dial's arc is ever written. */
	#core() {

		let ticks = '';
		for ( let i = 0; i < 96; i ++ ) {

			const angle = i / 96 * TAU - Math.PI / 2, outer = i % 12 ? 244 : 251;
			ticks += `M${fixed( Math.cos( angle ) * 238 )} ${fixed( Math.sin( angle ) * 238 )}L${fixed( Math.cos( angle ) * outer )} ${fixed( Math.sin( angle ) * outer )}`;

		}
		const marks = [ 0, 1, 2, 3 ].map( ( quarter ) => {

			const x = Math.round( Math.cos( quarter * Math.PI / 2 ) * 268 ), y = Math.round( Math.sin( quarter * Math.PI / 2 ) * 268 );
			return `M${x - 4} ${y}H${x + 4}M${x} ${y - 4}V${y + 4}`;

		} ).join( '' );
		const arc = svg( 'circle', { r: 225, class: 'hud-loading-arc', pathLength: 100, 'stroke-dasharray': 100, 'stroke-dashoffset': 100, transform: 'rotate(-90)' } );
		const dial = svg( 'svg', { class: 'hud-loading-dial', viewBox: '-280 -280 560 560' },
			svg( 'circle', { r: 211, class: 'hud-loading-faint' } ),
			svg( 'circle', { r: 247, class: 'hud-loading-faint' } ),
			svg( 'circle', { r: 225, class: 'hud-loading-track' } ),
			svg( 'path', { d: ticks, class: 'hud-loading-ticks' } ),
			svg( 'path', { d: marks, class: 'hud-loading-marks' } ),
			arc
		);
		const spin = ( name, radius, from, to ) => el( 'div', { className: `hud-loading-spin hud-loading-spin-${name}` },
			svg( 'svg', { viewBox: '-280 -280 560 560' }, svg( 'path', { d: arcPath( radius, from, to ) } ) )
		);
		const orbit = el( 'div', { className: 'hud-loading-orbit' },
			el( 'div', { className: 'hud-loading-orbit-spin' }, ...Array.from( { length: 9 }, ( _, index ) => {

				const node = el( 'span', { className: 'hud-loading-node' } );
				node.style.transform = `rotate(${index * 40}deg) translateX(var(--orbit))`;
				return node;

			} ) )
		);
		const element = el( 'div', { className: 'hud-loading-core' },
			el( 'div', { className: 'hud-loading-glow' } ),
			dial,
			spin( 'a', 214, 0, 0.5 ),
			spin( 'b', 231, 2, 3.1 ),
			orbit,
			el( 'div', { className: 'hud-loading-stage' }, crystal() )
		);
		element.setAttribute( 'aria-hidden', 'true' );

		return { element, arc };

	}

}

/** The percentage: up to three digits, a changed one arriving with a short jolt. */
class Digits {

	constructor() {

		this.slots = Array.from( { length: 3 }, () => {

			const paths = [];
			const slot = el( 'span', { className: 'hud-loading-digit', hidden: true }, ...BANDS.map( ( band ) => {

				const path = svg( 'path', {} );
				paths.push( path );
				return el( 'span', { className: `hud-loading-digit-band hud-loading-digit-${band}` }, svg( 'svg', { viewBox: '0 0 40 60' }, path ) );

			} ) );
			return { slot, paths, char: null };

		} );
		this.element = el( 'span', { className: 'hud-loading-digits' }, ...this.slots.map( ( { slot } ) => slot ) );
		this.element.setAttribute( 'aria-hidden', 'true' );

	}

	set( text ) {

		this.slots.forEach( ( entry, index ) => {

			const char = text[ index ] ?? null;
			if ( char === entry.char ) return;
			entry.char = char;
			entry.slot.hidden = char === null;
			if ( char === null ) return;
			for ( const path of entry.paths ) path.setAttribute( 'd', DIGITS[ char ] );
			// Switching between two animations restarts it without a reflow.
			entry.slot.dataset.flip = entry.slot.dataset.flip === 'a' ? 'b' : 'a';

		} );

	}

}

/** One milestone: a ring that fills while it is under way, then a check. */
class Milestone {

	constructor( { label }, index ) {

		this.label = label;
		this.index = index;
		this.state = null;
		this.progress = - 1;
		this.ring = svg( 'circle', { cx: 16, cy: 16, r: 12.5, class: 'hud-loading-ms-ring', pathLength: 100, 'stroke-dasharray': 100, 'stroke-dashoffset': 100, transform: 'rotate(-90 16 16)' } );
		const mark = el( 'span', { className: 'hud-loading-ms-mark' }, svg( 'svg', { viewBox: '0 0 32 32' },
			svg( 'circle', { cx: 16, cy: 16, r: 12.5, class: 'hud-loading-ms-track' } ), this.ring
		) );
		const check = el( 'span', { className: 'hud-loading-ms-check' }, svg( 'svg', { viewBox: '0 0 32 32' }, svg( 'path', { d: 'M10.5 16L14.1 19.6L21.5 12' } ) ) );
		const number = el( 'span', { className: 'hud-loading-ms-number', textContent: String( index + 1 ) } );
		for ( const node of [ mark, check, number ] ) node.setAttribute( 'aria-hidden', 'true' );
		this.element = el( 'li', { className: 'hud-loading-milestone' }, mark, check, number );

	}

	set( state, progress ) {

		if ( state !== this.state ) {

			this.state = state;
			this.element.dataset.state = state;
			this.element.setAttribute( 'aria-label', `${this.index + 1}. ${this.label}: ${layout.states[ state ]}` );
			if ( state === 'active' ) this.element.setAttribute( 'aria-current', 'step' );
			else this.element.removeAttribute( 'aria-current' );

		}
		const shown = state === 'pending' ? 0 : Math.round( ( state === 'done' ? 1 : progress ) * 100 );
		if ( shown !== this.progress ) {

			this.progress = shown;
			this.ring.setAttribute( 'stroke-dashoffset', String( 100 - shown ) );

		}

	}

}

/**
 * The icosahedron's thirty edges as lines placed in 3D, each drawn twice at
 * right angles about itself so no edge ever turns to nothing; the stage turns
 * them on the compositor.
 */
function crystal() {

	const phi = ( 1 + Math.sqrt( 5 ) ) / 2, size = 33;
	const vertices = [
		[ - 1, phi, 0 ], [ 1, phi, 0 ], [ - 1, - phi, 0 ], [ 1, - phi, 0 ],
		[ 0, - 1, phi ], [ 0, 1, phi ], [ 0, - 1, - phi ], [ 0, 1, - phi ],
		[ phi, 0, - 1 ], [ phi, 0, 1 ], [ - phi, 0, - 1 ], [ - phi, 0, 1 ]
	].map( ( point ) => point.map( ( value ) => value * size ) );
	const body = el( 'div', { className: 'hud-loading-crystal' } );
	for ( let a = 0; a < 12; a ++ ) for ( let b = a + 1; b < 12; b ++ ) {

		const [ ax, ay, az ] = vertices[ a ], [ bx, by, bz ] = vertices[ b ];
		const dx = bx - ax, dy = by - ay, dz = bz - az, length = Math.hypot( dx, dy, dz );
		if ( length > size * 2.01 ) continue;
		const place = `translate3d(${fixed( ax )}px,${fixed( ay )}px,${fixed( az )}px) rotateY(${fixed( Math.atan2( - dz, dx ) )}rad) rotateZ(${fixed( Math.asin( dy / length ) )}rad)`;
		for ( const roll of [ '', ' rotateX(90deg)' ] ) {

			const edge = el( 'span', { className: 'hud-loading-edge' } );
			edge.style.width = `${fixed( length )}px`;
			edge.style.transform = place + roll;
			body.append( edge );

		}

	}

	return body;

}

function svg( tag, attributes, ...children ) {

	const node = document.createElementNS( NS, tag );
	for ( const [ name, value ] of Object.entries( attributes ) ) node.setAttribute( name, String( value ) );
	if ( tag === 'svg' ) node.setAttribute( 'aria-hidden', 'true' );
	node.append( ...children );
	return node;

}

function arcPath( radius, from, to ) {

	return `M${fixed( Math.cos( from ) * radius )} ${fixed( Math.sin( from ) * radius )}A${radius} ${radius} 0 0 1 ${fixed( Math.cos( to ) * radius )} ${fixed( Math.sin( to ) * radius )}`;

}

function fixed( value ) {

	return Math.round( value * 100 ) / 100;

}
