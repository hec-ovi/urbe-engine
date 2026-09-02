/**
 * The browser side of a conversation: the player's line, the person they are
 * facing and what that person is doing go to the dev server's /api/talk, the
 * NPC's words come back.
 */
export class TalkClient {

	constructor( out, endpoint = '/api/talk' ) {

		this.out = out;
		this.endpoint = endpoint;

	}

	static nameOf( instance ) {

		return `${instance.name.given} ${instance.name.family}`;

	}

	/** @param conversation Interactor's { instance, behavior } */
	async say( conversation, line, timeMin ) {

		const response = await fetch( this.endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( { out: this.out, npc: conversation.instance, behavior: conversation.behavior, line, timeMin } )
		} );
		const data = await response.json();
		if ( ! response.ok ) throw new Error( data.error ?? `talk ${response.status}` );
		return data.reply;

	}

}
