/** Talk stream stand-ins, so a test decides exactly what the server says and when. */

/** The events of a reply spoken in these pieces: each delta, one sentence, then done. */
export function replyEvents( ...pieces ) {

	const reply = pieces.join( '' );
	return [ ...pieces.map( ( text ) => ( { type: 'delta', text } ) ), { type: 'sentence', index: 0, text: reply }, { type: 'done', reply } ];

}

/** A TalkClient.stream result that yields `events`, waiting for each promise among them, then throws `error` when given. */
export async function* talkStream( events, error = null ) {

	for ( const event of events ) yield await event;
	if ( error ) throw error;

}

export function talkError( message, status ) {

	return Object.assign( new Error( message ), { status } );

}
