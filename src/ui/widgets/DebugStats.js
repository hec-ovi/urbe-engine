import { el } from '../components/dom.js';

const TARGET_MS = 16.7;

/**
 * The performance readout, always on. Which backend and quality tier are live,
 * at what render size, then frame time, GPU milliseconds, draw calls and how
 * much of the world is up: a regression in any of them shows up here the moment
 * it happens rather than as "the game feels slow", and a screenshot of the
 * corner is enough to know which path the frame took.
 */
export class DebugStats {

	constructor() {

		this.rows = {};
		this.element = el( 'div', { className: 'hud-stats' } );

		for ( const key of [ 'path', 'fps', 'gpu', 'draws', 'tris', 'lights', 'crowd', 'cars', 'colliders' ] ) {

			this.rows[ key ] = el( 'div', {} );
			this.element.append( this.rows[ key ] );

		}

	}

	update( stats ) {

		const frame = stats.frameMs;
		this.#set( 'path', `${stats.backend ?? '-'}  ${stats.tier}  ${stats.width}x${stats.height}`, stats.backend === 'webgl' );
		this.#set( 'fps', `${( 1000 / Math.max( frame, 0.01 ) ).toFixed( 0 )} fps  ${frame.toFixed( 1 )} ms`, frame > TARGET_MS * 1.25 );
		this.#set( 'gpu', stats.gpuMs > 0 ? `gpu ${stats.gpuMs.toFixed( 2 )} ms` : 'gpu -', false );
		this.#set( 'draws', `${stats.drawCalls} draws`, stats.drawCalls > 320 );
		this.#set( 'tris', `${( stats.triangles / 1000 ).toFixed( 0 )}k tris`, false );
		this.#set( 'lights', `${stats.lights} lights`, false );
		this.#set( 'crowd', `${stats.crowd} people`, false );
		this.#set( 'cars', `${stats.cars} cars`, false );
		this.#set( 'colliders', `${stats.interiors} interiors live`, false );

	}

	#set( key, text, warn ) {

		const row = this.rows[ key ];

		if ( row.textContent !== text ) row.textContent = text;

		row.className = warn ? 'hud-stats-warn' : '';

	}

}
