import { el } from '../components/dom.js';

const STATES = new Set( [ 'idle', 'thinking', 'streaming', 'speaking' ] );
/** The shell draws at most this often; a frame between draws costs one comparison. */
const FRAME_MS = 1000 / 24;
/** A dotted sphere: eighteen meridians of eleven dots, tilted a little toward the viewer. */
const POINTS = new Float32Array( 18 * 11 * 3 );
const TILT_SIN = Math.sin( - 0.22 ), TILT_COS = Math.cos( - 0.22 );
for ( let column = 0; column < 18; column ++ ) {

	const longitude = column * Math.PI / 9;
	for ( let row = 0; row < 11; row ++ ) {

		const latitude = ( row - 5 ) * 0.25, ring = Math.cos( latitude ), index = ( column * 11 + row ) * 3;
		POINTS[ index ] = Math.sin( longitude ) * ring;
		POINTS[ index + 1 ] = Math.sin( latitude );
		POINTS[ index + 2 ] = Math.cos( longitude ) * ring;

	}

}

/** Orbs drawing now, and the one frame request they share. */
const drawing = new Set();
let request = 0;
let drawn = - Infinity;

function frame( now ) {

	request = 0;
	if ( now - drawn >= FRAME_MS ) {

		drawn = now;
		for ( const orb of drawing ) {

			if ( orb.element.isConnected ) orb.paint( now );
			else drawing.delete( orb );

		}

	}
	schedule();

}

function schedule() {

	if ( ! request && drawing.size && typeof requestAnimationFrame === 'function' ) request = requestAnimationFrame( frame );

}

/**
 * The thinking orb: a small dotted shell with a hollow, turning while a reply
 * is awaited (`thinking`), arrives (`streaming`) or is voiced (`speaking`),
 * hidden while `idle`. Every orb shares one frame request, made only while
 * one of them turns and drawn at most 24 times a second; the browser holds it
 * while the page is hidden. It takes the colour of its text (`currentColor`)
 * when its state changes. Under reduced motion it stands still. Decorative:
 * the owner says in words what it waits for.
 */
export class ThinkingOrb {

	constructor( { size = 32 } = {} ) {

		this.size = size;
		this.state = 'idle';
		this.canvas = el( 'canvas' );
		const pixels = Math.ceil( size * Math.min( 2, Math.max( 1, window.devicePixelRatio || 1 ) ) );
		this.canvas.width = this.canvas.height = pixels;
		this.element = el( 'span', { className: 'thinking-orb', hidden: true }, this.canvas );
		this.element.style.setProperty( '--orb', `${size}px` );
		this.element.setAttribute( 'aria-hidden', 'true' );

	}

	/** `idle`, `thinking`, `streaming` or `speaking`; another state throws. */
	setState( state ) {

		if ( ! STATES.has( state ) ) throw new RangeError( `unknown orb state: ${state}` );
		if ( state === this.state ) return;
		this.state = state;
		this.element.hidden = state === 'idle';
		if ( state === 'idle' ) {

			drawing.delete( this );
			return;

		}
		this.context ??= this.canvas.getContext( '2d' );
		if ( this.context ) this.context.setTransform( this.canvas.width / this.size, 0, 0, this.canvas.width / this.size, 0, 0 );
		this.color = getComputedStyle( this.element ).color || '#e3ca7d';
		this.paint( 0 );
		if ( ! window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches ) {

			drawing.add( this );
			schedule();

		}

	}

	/** Draws the shell turned for time `now`, in milliseconds. */
	paint( now ) {

		const ctx = this.context;
		if ( ! ctx ) return;
		const speed = this.state === 'streaming' ? 0.00044 : this.state === 'speaking' ? 0.00052 : 0.00029;
		const angle = now * speed + 0.16, sin = Math.sin( angle ), cos = Math.cos( angle );
		const size = this.size, radius = size * 0.445, centre = size / 2, dot = Math.max( 0.8, size * 0.03 );
		const intensity = this.state === 'speaking' ? 1.5 : 1.3;
		ctx.clearRect( 0, 0, size, size );
		ctx.fillStyle = this.color;
		for ( let index = 0; index < POINTS.length; index += 3 ) {

			const x = POINTS[ index ] * cos + POINTS[ index + 2 ] * sin;
			const z = POINTS[ index + 2 ] * cos - POINTS[ index ] * sin;
			const y = POINTS[ index + 1 ] * TILT_COS - z * TILT_SIN;
			const depth = POINTS[ index + 1 ] * TILT_SIN + z * TILT_COS;
			// The hollow: an ellipse through the shell's front, its dots left out and its rim fading in.
			const hollow = y - 0.06, aperture = x * x / 0.3025 + hollow * hollow / 0.16;
			if ( aperture < 1 ) continue;
			ctx.globalAlpha = Math.min( 1, ( 0.37 + ( 1 - y ) * 0.27 ) * ( 0.66 + depth * 0.26 ) * intensity * Math.min( 1, ( aperture - 1 ) * 2.8 ) );
			const width = dot * ( 0.83 + ( depth + 1 ) * 0.22 ), height = width * 1.7;
			ctx.fillRect( centre + x * radius - width / 2, centre + y * radius - height / 2, width, height );

		}
		ctx.globalAlpha = 1;

	}

	/** Whether any orb turns now, for tests and measurements. */
	static get turning() {

		return drawing.size > 0;

	}

}
