import { el } from '../components/dom.js';
import { emptyState } from '../components/EmptyState.js';
import { icon } from '../components/Icon.js';
import '../components/call-avatar.css';

/**
 * A framed call with somebody: their picture (a video or canvas the game
 * hands over), their name, and the hang up button. props: { onHangUp() }
 */
export class VideoCallPanel {

	constructor( { onHangUp } ) {

		this.screen = el( 'div', { className: 'call-screen' }, emptyState( 'Waiting for video' ) );
		this.status = el( 'span', { className: 'call-status', role: 'status', textContent: 'connecting' } );
		this.name = el( 'div', { className: 'call-name' } );
		this.hangUp = el( 'button', { className: 'hud-button call-hangup', type: 'button' }, icon( 'hangup' ), 'hang up' );
		this.hangUp.addEventListener( 'click', onHangUp );

		this.element = el( 'div', { className: 'call' },
			el( 'header', { className: 'call-header' }, el( 'span', { textContent: 'VIDEO LINK' } ), this.status ),
			this.screen,
			el( 'div', { className: 'call-footer' }, this.name, this.hangUp )
		);
		this.element.hidden = true;

	}

	/** @param stream a <video> or <canvas> element that draws the caller. */
	setStream( stream ) {

		this.screen.replaceChildren( stream );
		this.status.textContent = 'Video received';

	}

	setName( name ) {

		this.name.textContent = name;
		this.element.setAttribute( 'aria-label', `Video call with ${name}` );

	}

	setVisible( visible ) {

		this.element.hidden = ! visible;

	}

}
