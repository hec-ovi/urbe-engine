/**
 * Development timing of one frame's draws by what they draw: asked to `sample`,
 * the renderer's next render times each object it draws, filed under the
 * object's name up to its second colon (or its type), and hands the frame back
 * as `{ name: { ms, calls } }` with what the scene pass spent outside them.
 * The time of a draw includes what the object does before it is drawn, a
 * batch culling its copies among it.
 */
export class DrawTimes {

	constructor( renderer ) {

		this.renderer = renderer;
		this.wanted = false;
		this.taking = null;
		/** The last frame sampled, or null. */
		this.last = null;

	}

	/** Times the draws of the next scene pass. */
	sample() {

		this.wanted = true;

	}

	/** Around the scene pass: `begin` before it, `end` after with its milliseconds. */
	begin() {

		if ( ! this.wanted ) return;
		this.wanted = false;
		const renderer = this.renderer;
		const times = new Map();
		const previous = renderer.getRenderObjectFunction();
		renderer.setRenderObjectFunction( function ( object, ...args ) {

			const started = performance.now();
			try {

				( previous ?? renderer.renderObject ).call( renderer, object, ...args );

			} finally {

				const key = nameOf( object );
				const entry = times.get( key ) ?? { ms: 0, calls: 0 };
				entry.ms += performance.now() - started;
				entry.calls ++;
				times.set( key, entry );

			}

		} );
		this.taking = { times, previous };

	}

	end( sceneMs ) {

		if ( ! this.taking ) return;
		const { times, previous } = this.taking;
		this.taking = null;
		this.renderer.setRenderObjectFunction( previous );
		let drawn = 0;
		const out = {};
		for ( const [ key, entry ] of [ ...times ].sort( ( a, b ) => b[ 1 ].ms - a[ 1 ].ms ).slice( 0, 24 ) ) out[ key ] = { ms: round( entry.ms ), calls: entry.calls };
		for ( const entry of times.values() ) drawn += entry.ms;
		out[ '(outside the draws)' ] = { ms: round( sceneMs - drawn ), calls: 0 };
		this.last = out;

	}

}

function nameOf( object ) {

	const name = object.name ? object.name.split( ':' ).slice( 0, 2 ).join( ':' ) : object.type;
	return name.slice( 0, 48 ) || 'unnamed';

}

function round( ms ) {

	return Math.round( ms * 100 ) / 100;

}
