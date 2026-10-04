/** The WebGL calls that can hold the page's thread: the draws, the uploads, and those that wait on the GPU. */
const CALLS = [
	'drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements',
	'bufferData', 'bufferSubData', 'texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'texStorage2D', 'generateMipmap',
	'readPixels', 'getError', 'clientWaitSync', 'getBufferSubData', 'finish', 'flush', 'useProgram', 'compileShader', 'linkProgram'
];
const MULTI_DRAW = [ 'multiDrawElementsWEBGL', 'multiDrawArraysWEBGL', 'multiDrawElementsInstancedWEBGL', 'multiDrawArraysInstancedWEBGL' ];

/**
 * Development timing of one WebGL context: each listed call on this context,
 * and on its multi-draw extension once asked for, is timed where it is made.
 * A frame whose thread waits on a GPU busy with other work spends it inside
 * these calls; one that is busy with its own scripts does not.
 */
export class GlTimes {

	constructor( gl ) {

		this.times = new Map();
		for ( const name of CALLS ) this.#wrap( gl, name );
		const getExtension = gl.getExtension.bind( gl );
		gl.getExtension = ( name ) => {

			const extension = getExtension( name );
			if ( extension && name === 'WEBGL_multi_draw' && ! extension.timed ) {

				for ( const call of MULTI_DRAW ) this.#wrap( extension, call );
				extension.timed = true;

			}
			return extension;

		};
		// WebGL hands back one object per extension, so the one the renderer already holds is timed too.
		gl.getExtension( 'WEBGL_multi_draw' );

	}

	#wrap( target, name ) {

		const call = target[ name ];
		if ( typeof call !== 'function' ) return;
		const entry = { ms: 0, calls: 0 };
		this.times.set( name, entry );
		target[ name ] = function ( ...args ) {

			const started = performance.now();
			try { return call.apply( this, args ); } finally { entry.ms += performance.now() - started; entry.calls ++; }

		};

	}

	/** Milliseconds and calls per frame over `frames` frames since the last drain, for the calls made at all. */
	drain( frames = 1 ) {

		const out = {};
		const per = Math.max( 1, frames );
		for ( const [ name, entry ] of this.times ) {

			if ( entry.calls ) out[ name ] = { ms: Math.round( entry.ms / per * 100 ) / 100, calls: Math.round( entry.calls / per * 10 ) / 10 };
			entry.ms = 0;
			entry.calls = 0;

		}
		return out;

	}

}
