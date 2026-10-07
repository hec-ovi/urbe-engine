import { colorGraph } from './PanelGraph.js';

/** Colours one set's panel graph off the main thread: `{ weights, units }` in, `{ colors, conflicts, edges, counts }` (or `{ error }`) out. */
self.onmessage = ( { data } ) => {

	try {

		const result = colorGraph( data.weights, data.units );
		self.postMessage( result, [ result.colors.buffer ] );

	} catch ( error ) {

		self.postMessage( { error: String( error?.message ?? error ) } );

	}

};
