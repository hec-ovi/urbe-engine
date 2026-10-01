import { el } from '../components/dom.js';
import { icon } from '../components/Icon.js';
import '../components/call-avatar.css';
import layout from './call-layout.json' with { type: 'json' };

const SEGMENTS = 12;
const STATUSES = new Set( Object.keys( layout.status ) );

/**
 * A phone call with a contact, framed as the studio's call widget: the
 * private line and its state, the person's portrait head with what the line
 * carries, their name, role and signal, what is happening, the controls the
 * state allows and where the call reaches them. Labels come from
 * [call-layout.json](call-layout.json) ([schema](call-layout.schema.json)).
 * The host owns the call; the panel only reports intents.
 * props: { onHangUp(), onRedial(), onClose() }
 */
export class CallPanel {

	constructor( { onHangUp = () => {}, onRedial = () => {}, onClose = () => {} } = {} ) {

		this.contact = null;
		this.state = { status: 'connecting', duration: '', relay: '', signal: 0, line: '' };
		this.presentation = 'expanded';

		this.statusText = el( 'span' );
		this.status = el( 'div', { className: 'phone-call-status', role: 'status' }, el( 'i', { ariaHidden: 'true' } ), this.statusText );
		this.status.setAttribute( 'aria-live', 'polite' );
		this.toggle = el( 'button', { className: 'phone-call-presentation', type: 'button' }, icon( 'compact' ) );
		this.toggle.addEventListener( 'click', () => this.setPresentation( this.presentation === 'compact' ? 'expanded' : 'compact' ) );
		this.portrait = el( 'img', { className: 'phone-call-portrait', alt: '', draggable: false } );
		this.portrait.hidden = true;
		this.handle = el( 'span', { className: 'phone-call-handle' } );
		this.audio = el( 'span', { className: 'phone-call-audio' } );
		this.duration = el( 'span', { className: 'phone-call-duration' } );
		this.frame = el( 'div', { className: 'phone-call-frame' },
			this.portrait,
			el( 'div', { className: 'phone-call-frame-label' }, el( 'span', { textContent: layout.portrait } ), this.handle ),
			el( 'div', { className: 'phone-call-frame-bottom' }, this.audio, this.duration ),
			el( 'div', { className: 'phone-call-reveal', ariaHidden: 'true' } )
		);
		this.name = el( 'h2', { className: 'phone-call-name' } );
		this.role = el( 'p', { className: 'phone-call-role' } );
		this.bars = Array.from( { length: SEGMENTS }, () => el( 'i', { ariaHidden: 'true' } ) );
		this.signal = el( 'div', { className: 'phone-call-signal', role: 'meter' }, ...this.bars );
		this.signal.setAttribute( 'aria-label', layout.signal );
		this.signal.setAttribute( 'aria-valuemin', '0' );
		this.signal.setAttribute( 'aria-valuemax', '100' );
		this.detail = el( 'p', { className: 'phone-call-detail' } );
		this.redial = action( layout.redial, 'phone', 'phone-call-action is-primary', onRedial );
		this.hangUp = action( layout.hangup, 'hangup', 'phone-call-action is-danger', onHangUp );
		this.close = action( layout.close, 'close', 'phone-call-action', onClose );
		this.relay = el( 'span' );

		this.element = el( 'section', { className: 'phone-call', tabIndex: - 1 },
			el( 'header', { className: 'phone-call-header' }, el( 'span', { className: 'phone-call-channel', textContent: layout.channel } ), this.status, this.toggle ),
			this.frame,
			el( 'div', { className: 'phone-call-info' }, el( 'div', { className: 'phone-call-identity' }, this.name, this.role ), this.signal ),
			this.detail,
			el( 'div', { className: 'phone-call-actions' }, this.redial, this.hangUp, this.close ),
			el( 'footer', { className: 'phone-call-footer' }, this.relay, el( 'span', { textContent: layout.footer } ) )
		);
		this.element.hidden = true;
		this.setPresentation( 'expanded' );
		this.#render();

	}

	/** The person called: `{ name, role?, handle?, portraitUrl? }`; a portrait that comes later is set again. */
	setContact( contact ) {

		this.contact = contact;
		this.#render();

	}

	/**
	 * Where the call stands: `{ status, duration?, relay?, signal?, line? }`.
	 * `status` is connecting, connected, busy, ended, declined or no-answer;
	 * `duration` the time talked as the host formats it, `relay` where the
	 * call reaches them, `signal` in 0..1 and `line` what a busy person said.
	 * Omitted fields keep their value.
	 */
	setState( state ) {

		this.state = { ...this.state, ...state };
		if ( ! STATUSES.has( this.state.status ) ) this.state.status = 'ended';
		this.#render();

	}

	setPresentation( presentation ) {

		this.presentation = presentation === 'compact' ? 'compact' : 'expanded';
		this.element.dataset.presentation = this.presentation;
		const label = this.presentation === 'compact' ? layout.expand : layout.compact;
		this.toggle.setAttribute( 'aria-label', label );
		this.toggle.title = label;
		this.toggle.setAttribute( 'aria-expanded', String( this.presentation === 'expanded' ) );
		this.toggle.replaceChildren( icon( this.presentation === 'compact' ? 'expand' : 'compact' ) );

	}

	setVisible( visible ) {

		this.element.hidden = ! visible;

	}

	#render() {

		const { status, duration, relay, signal, line } = this.state;
		const descriptor = layout.status[ status ];
		const name = this.contact?.name ?? '';
		const connected = status === 'connected';
		const live = connected || status === 'connecting' || status === 'busy';
		this.element.dataset.status = status;
		this.element.dataset.tone = descriptor.tone;
		this.element.setAttribute( 'aria-label', fill( layout.contact, { name } ) );
		this.statusText.textContent = descriptor.label;
		this.name.textContent = name;
		this.role.textContent = this.contact?.role ?? '';
		this.role.hidden = ! this.contact?.role;
		this.handle.textContent = this.contact?.handle ?? '';
		const url = this.contact?.portraitUrl ?? null;
		if ( url && this.portrait.getAttribute( 'src' ) !== url ) this.portrait.src = url;
		this.portrait.alt = name;
		this.portrait.hidden = ! url;
		this.audio.textContent = connected ? layout.audio : descriptor.label.toUpperCase();
		this.duration.textContent = connected && duration ? fill( layout.duration, { duration } ) : '';
		this.detail.textContent = status === 'busy' && line ? line : fill( descriptor.detail, { name } );
		this.relay.textContent = relay ?? '';
		const lit = connected ? Math.round( Math.min( 1, Math.max( 0, Number.isFinite( signal ) ? signal : 0 ) ) * SEGMENTS ) : 0;
		this.bars.forEach( ( bar, index ) => { bar.dataset.on = String( index < lit ); } );
		this.signal.setAttribute( 'aria-valuenow', String( Math.round( lit / SEGMENTS * 100 ) ) );
		this.hangUp.hidden = ! live;
		this.hangUp.lastChild.textContent = status === 'connecting' ? layout.cancel : layout.hangup;
		this.redial.hidden = live;
		this.close.hidden = live;

	}

}

function action( label, name, className, onClick ) {

	const button = el( 'button', { className, type: 'button' }, icon( name ), el( 'span', { textContent: label } ) );
	button.addEventListener( 'click', () => onClick() );
	return button;

}

function fill( template, values ) {

	return template.replace( /\{(\w+)\}/g, ( field, name ) => String( values[ name ] ?? field ) );

}
