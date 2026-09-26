/**
 * The browser side of a conversation: the player's line, the person they are
 * facing and what that person is doing go to the dev server's
 * /api/talk/stream, and the NPC's words come back as they are spoken. A
 * failure throws an Error whose `status` is the HTTP status the server gave.
 */
export class TalkClient {

	constructor( out ) {

		this.out = out;

	}

	static nameOf( instance ) {

		return `${instance.name.given} ${instance.name.family}`;

	}

	/**
	 * The reply as it is spoken, one event at a time: `{ type: 'delta', text }`,
	 * `{ type: 'sentence', index, text }`, `{ type: 'offer', kind, placeId?, name? }`
	 * and last `{ type: 'done', reply }`. An `error` event throws with status 502.
	 * Leaving the loop early, or aborting `signal`, ends the reply on the server.
	 * @param conversation Interactor's { instance, behavior }
	 * @param quests the questlines as they stand, QuestSession.snapshot()
	 * @param options.guide the place this person has led the player to, { placeId, kind, name?, notes? }
	 * @param options.offers what this person may propose, { follow?, places?: [{ placeId, name }] }
	 */
	async *stream( conversation, line, timeMin, quests = [], { signal, guide, offers } = {} ) {

		const response = await this.#post( { conversation, line, timeMin, quests, guide, offers }, signal );
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		try {

			for ( ;; ) {

				const { done, value } = await reader.read();
				buffer += decoder.decode( value, { stream: ! done } );
				const lines = buffer.split( '\n' );
				buffer = done ? '' : lines.pop();
				for ( const text of lines ) {

					if ( ! text.trim() ) continue;
					const event = JSON.parse( text );
					if ( event.type === 'error' ) throw talkError( event.error, 502 );
					yield event;
					if ( event.type === 'done' ) return;

				}
				if ( done ) throw talkError( 'the reply ended before it was done', 502 );

			}

		} finally {

			reader.cancel().catch( () => {} );

		}

	}

	async #post( { conversation, line, timeMin, quests, guide, offers }, signal ) {

		const response = await fetch( '/api/talk/stream', {
			method: 'POST',
			signal,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( {
				out: this.out, npc: conversation.instance, behavior: conversation.behavior, line, timeMin, quests,
				...( guide ? { guide } : {} ), ...( offers ? { offers } : {} )
			} )
		} );
		if ( response.ok ) return response;
		const text = await response.text().catch( () => '' );
		let message = null;
		try { message = JSON.parse( text ).error; } catch { /* not the route's JSON error */ }
		throw talkError( message || `talk ${response.status}`, response.status );

	}

}

function talkError( message, status ) {

	return Object.assign( new Error( message ), { status } );

}
