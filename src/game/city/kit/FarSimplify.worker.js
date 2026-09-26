import { simplifyFar } from './FarSimplify.js';

/** One surface at a time, off the main thread: `{ id, index, count, attributes }` in, `{ id, index }` or `{ id, error }` out. */
self.onmessage = async ( { data: { id, index, count, attributes } } ) => {

	try {

		const kept = await simplifyFar( index, count, attributes );
		self.postMessage( { id, index: kept }, [ kept.buffer ] );

	} catch ( error ) {

		self.postMessage( { id, error: String( error?.message ?? error ) } );

	}

};
