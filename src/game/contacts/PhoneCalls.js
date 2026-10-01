import { CallSession } from './Calls.js';

/** Seconds a call that is over stays on the call screen. */
export const LINGER_SECONDS = 6;

/**
 * The player's phone: one call at a time, from ringing to the call screen
 * going away. It rings for the session's time, opens the conversation over
 * the phone when the person picks up (`open`), hangs up when the player does
 * or the conversation closes, and keeps the call screen (`view`, a CallPanel)
 * showing the state, the time talked, where the call reaches the person and
 * how clear the line is. A call over stays on screen LINGER_SECONDS.
 */
export class PhoneCalls {

	/**
	 * @param view the call screen: setContact, setState, setPresentation, setVisible
	 * @param answerOf( npcId ) how the person takes a call now (Calls `answerOf`)
	 * @param open( npcId ) opens the conversation over the phone; null when it cannot
	 * @param close() closes the conversation over the phone
	 * @param contactOf( npcId ) `{ name, role, handle }` as the call screen names them
	 * @param portraitOf( npcId ) a promise of their portrait's URL, or null
	 * @param reach( npcId ) `{ relay, signal }`: where the call reaches them and how clear the line is
	 * @param busyLine( npcId ) what a person at work says before hanging up
	 */
	constructor( { view, answerOf, open, close, contactOf, portraitOf = () => Promise.resolve( null ), reach = () => ( { relay: '', signal: 1 } ), busyLine = () => '' } ) {

		Object.assign( this, { view, answerOf, open, close, contactOf, portraitOf, reach, busyLine } );
		this.session = null;
		this.shownDuration = null;

	}

	/** The call under way or just over, or null. */
	get npcId() {

		return this.session?.npcId ?? null;

	}

	/** Whether a call rings or is talked on now. */
	get live() {

		return Boolean( this.session?.live );

	}

	/** Rings this person; a call under way gives way to it. */
	call( npcId ) {

		if ( this.session?.status === 'connected' ) this.close();
		this.session = new CallSession( { npcId, answer: this.answerOf( npcId ) } );
		const contact = this.contactOf( npcId );
		this.view.setContact( contact );
		this.view.setPresentation( 'expanded' );
		Promise.resolve( this.portraitOf( npcId ) ).then( ( portraitUrl ) => {

			if ( portraitUrl && this.session?.npcId === npcId ) this.view.setContact( { ...contact, portraitUrl } );

		}, () => {} );
		this.#show();
		return this.session;

	}

	/** One frame of the player's own time: the ring, the answer, a busy person hanging up, the time talked. */
	update( seconds ) {

		const session = this.session;
		if ( ! session ) return;
		const changed = session.update( seconds );
		if ( changed === 'connected' && ! this.open( session.npcId ) ) session.hangUp();
		if ( ! session.live && session.seconds - session.endedAt > LINGER_SECONDS ) return this.drop();
		if ( changed || session.duration !== this.shownDuration ) this.#show();

	}

	/** The player hangs up: the conversation over the phone closes and the call shows ended. */
	hangUp() {

		const session = this.session;
		if ( ! session ) return;
		const talking = session.status === 'connected';
		session.hangUp();
		if ( talking ) this.close();
		this.#show();

	}

	/** The conversation over the phone closed on its own (the chat's leave, Escape): the call is over. */
	closed( npcId ) {

		if ( this.session?.npcId === npcId && this.session.hangUp() ) this.#show();

	}

	/** The call screen goes. */
	drop() {

		this.session = null;
		this.shownDuration = null;
		this.view.setVisible( false );

	}

	#show() {

		const session = this.session;
		if ( ! session ) return;
		this.shownDuration = session.duration;
		const { relay = '', signal = 1 } = this.reach( session.npcId ) ?? {};
		this.view.setState( {
			status: session.status, duration: session.duration, relay, signal,
			line: session.status === 'busy' ? this.busyLine( session.npcId ) : ''
		} );
		this.view.setVisible( true );

	}

}
