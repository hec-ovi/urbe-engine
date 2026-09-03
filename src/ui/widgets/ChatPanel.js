import { el } from '../components/dom.js';
import { icon } from '../components/Icon.js';
import { PanelHeader } from '../components/PanelHeader.js';
import { npcProfile } from './NpcProfile.js';

/**
 * Talking to one person: their name and Esc up top, the transcript, and the
 * line to type into. Presentation only: the game feeds every message.
 * props: { onSend( text ), onClose() }
 */
export class ChatPanel {

	constructor( { onSend, onClose } ) {

		this.onSend = onSend;
		this.header = new PanelHeader( { title: '', onClose } );
		this.profile = el( 'div', { className: 'chat-profile' } );
		this.transcript = el( 'div', { className: 'chat-transcript' } );

		this.input = el( 'input', { className: 'chat-input', type: 'text', placeholder: 'say something' } );
		this.input.setAttribute( 'aria-label', 'say something' );
		this.input.addEventListener( 'keydown', ( event ) => {

			if ( event.key === 'Enter' ) this.#send();
			if ( event.key === 'Escape' ) onClose();

		} );

		this.send = el( 'button', { className: 'chat-send', type: 'button' }, icon( 'send' ) );
		this.send.setAttribute( 'aria-label', 'send' );
		this.send.addEventListener( 'click', () => this.#send() );

		this.element = el( 'div', { className: 'chat' },
			this.header.element,
			this.profile,
			this.transcript,
			el( 'div', { className: 'chat-compose' }, this.input, this.send )
		);

		this.profile.hidden = true;
		this.element.hidden = true;

	}

	/** Who is on the other side. @param npc { name, role } */
	setNpc( { name, role = '' } ) {

		this.header.setTitle( role ? `${name} · ${role}` : name );

	}

	/** Facts under the header. @param profile { facts: [[key, value]], now, routine: [line] }; null hides the block. */
	setProfile( profile ) {

		this.profile.hidden = ! profile;

		if ( ! profile ) return;

		this.profile.replaceChildren(
			...profile.facts.map( ( [ key, value ] ) => el( 'div', { className: 'chat-profile-row' },
				el( 'span', { className: 'chat-profile-key', textContent: key } ),
				el( 'span', { textContent: value } )
			) ),
			profile.now ? el( 'div', { className: 'chat-profile-now', textContent: profile.now } ) : '',
			profile.routine.length
				? el( 'ul', { className: 'chat-profile-routine' }, ...profile.routine.map( ( line ) => el( 'li', { textContent: line } ) ) )
				: ''
		);

	}

	/** @param message { from: 'npc' | 'player', name, text } */
	addMessage( { from, name, text } ) {

		this.transcript.append( el( 'div', { className: `chat-line is-${from}` },
			el( 'div', { className: 'chat-line-from', textContent: name ?? ( from === 'player' ? 'you' : '' ) } ),
			el( 'div', { textContent: text } )
		) );
		this.transcript.scrollTop = this.transcript.scrollHeight;

	}

	setTranscript( messages ) {

		this.transcript.replaceChildren();
		for ( const message of messages ) this.addMessage( message );

	}

	/**
	 * Opens on a simulation conversation { instance, behavior }: name and
	 * profile from the instance, a fresh transcript. Falsy closes the panel.
	 */
	show( conversation ) {

		this.setVisible( Boolean( conversation ) );

		if ( ! conversation ) return;

		const profile = npcProfile( conversation );
		this.setNpc( profile );
		this.setProfile( profile );
		this.setTranscript( [] );
		this.input.value = '';
		this.input.focus();

	}

	setVisible( visible ) {

		this.element.hidden = ! visible;

	}

	#send() {

		const text = this.input.value.trim();

		if ( ! text ) return;

		this.input.value = '';
		this.onSend( text );

	}

}
