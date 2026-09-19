/** Names listed on one line before the rest are counted. */
const NAMED = 6;

/**
 * What the renderer built for itself in the frame that just ended.
 *
 * A material draws for the first time and the backend compiles its program
 * right there, on the frame that wanted it; a map reaches a shader for the
 * first time and the whole mip chain uploads the same way. On WebGL2 both are
 * blocking calls, and either can be the whole of a freeze that the world's own
 * notes cannot explain, because the world did nothing: it just looked at
 * something new.
 *
 * The renderer's own accounting is what says so. Every program and texture it
 * creates or destroys passes through `info`, so those calls are what is counted
 * here, by name, rather than the net change in the counters: a program dropped
 * and linked again in the same frame is a stall the counters would never show.
 */
export class RenderWork {

	/** @param info `renderer.info`, whose create and destroy calls this listens to */
	constructor( info ) {

		this.linked = new Map();
		this.released = new Map();
		this.uploaded = 0;
		this.uploadedBytes = 0;
		this.freed = 0;
		const listen = ( method, after ) => {

			const original = info?.[ method ];
			if ( typeof original !== 'function' ) return;
			info[ method ] = ( item ) => {

				original.call( info, item );
				after( item );

			};

		};

		listen( 'createProgram', ( program ) => count( this.linked, program ) );
		listen( 'destroyProgram', ( program ) => count( this.released, program ) );
		listen( 'createTexture', ( texture ) => {

			this.uploaded ++;
			this.uploadedBytes += info.memoryMap?.get( texture ) ?? 0;

		} );
		listen( 'destroyTexture', () => this.freed ++ );

	}

	/**
	 * @returns a note for the frame that just ended, or null when the renderer
	 * built nothing new in it
	 */
	since() {

		const built = [];
		const linked = programs( this.linked, 'linked' );
		const released = programs( this.released, 'released' );

		if ( linked ) built.push( linked );
		if ( released ) built.push( released );
		if ( this.uploaded > 0 ) {

			const size = this.uploadedBytes >= 1 << 20 ? ` (${( this.uploadedBytes / ( 1 << 20 ) ).toFixed( 0 )} MB)` : '';
			built.push( `${this.uploaded} texture${this.uploaded === 1 ? '' : 's'} uploaded${size}` );

		}

		this.linked.clear();
		this.released.clear();
		this.uploaded = 0;
		this.uploadedBytes = 0;
		this.freed = 0;

		return built.length ? built.join( ', ' ) : null;

	}

}

function count( names, program ) {

	const name = `${program.name || 'unnamed'} ${program.stage}`;
	names.set( name, ( names.get( name ) ?? 0 ) + 1 );

}

/** "N shaders linked (name xk, ..., m more)", or null when none were. */
function programs( names, what ) {

	let total = 0;
	for ( const count of names.values() ) total += count;
	if ( total === 0 ) return null;

	const sorted = [ ...names ].sort( ( a, b ) => b[ 1 ] - a[ 1 ] );
	const shown = sorted.slice( 0, NAMED ).map( ( [ name, count ] ) => ( count > 1 ? `${name} x${count}` : name ) );
	if ( sorted.length > NAMED ) shown.push( `${sorted.length - NAMED} more` );

	return `${total} shader${total === 1 ? '' : 's'} ${what} (${shown.join( ', ' )})`;

}
