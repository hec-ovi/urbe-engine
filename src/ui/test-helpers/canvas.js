/**
 * jsdom has no 2d context. This one records every method call and property
 * set as [name, ...args] in ctx.calls, so a test can count draws and read
 * the colours a view painted with.
 */
export function stubCanvas() {

	HTMLCanvasElement.prototype.getContext = function ( type ) {

		// Only the 2d context is stood in for; WebGL stays absent, as in jsdom.
		if ( type !== '2d' ) return null;

		const target = { calls: [], canvas: this };

		return new Proxy( target, {
			get: ( obj, key ) => key in obj ? obj[ key ] : ( ...args ) => { obj.calls.push( [ key, ...args ] ); },
			set: ( obj, key, value ) => {

				obj[ key ] = value;
				obj.calls.push( [ 'set', key, value ] );

				return true;

			}
		} );

	};

}

export function count( ctx, name ) {

	return ctx.calls.filter( ( call ) => call[ 0 ] === name ).length;

}
