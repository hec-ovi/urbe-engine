import { simplifyFar } from './FarSimplify.js';

/** One surface at a time, off the main thread: `{ id, index, count, attributes }` in, `{ id, far }` or `{ id, error }` out. */
self.onmessage = async ( { data: { id, index, count, attributes } } ) => {

	try {

		const far = await simplifyFar( index, count, attributes );
		self.postMessage( { id, far }, [ far.index.buffer, ...far.attributes.map( ( values ) => values.buffer ) ] );

	} catch ( error ) {

		self.postMessage( { id, error: String( error?.message ?? error ) } );

	}

};
